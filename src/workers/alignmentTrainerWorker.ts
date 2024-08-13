import { parentPort } from "node:worker_threads";
import { WorkerMessage } from "./alignmentTrainerTypes";
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { TSourceTargetAlignment, TTrainingAndTestingData } from "../usfmStuff/utils";
import { Token } from "wordmap-lexer";
import { Alignment, Ngram } from "wordmap";
import { updateTokenLocations } from "wordmapbooster/dist/wordmap_tools";
import { MorphJLBoostWordMap } from "wordmapbooster/dist/boostwordmap_tools";
import { Uri } from "vscode";
import { bookGroupToModelName, getAllAlignmentDataFromCodexBook, getBookGroups } from "../usfmStuff/utilsWithFs";

let nextRequestId : number = 0;
//callbacks a map from a number to a resolve or reject function
const callbackPairs : Map<number, [Function, Function]> = new Map();


function postMessageWithResponse(message:WorkerMessage): Promise<WorkerMessage> {
    const requestId : number = nextRequestId++;
    const p = new Promise<WorkerMessage>((resolve, reject) => callbackPairs.set(requestId, [resolve, reject]));

    const out_message: WorkerMessage = {
        ...message,
        requestId
    };

    parentPort?.postMessage(out_message);
    return p;
}

parentPort?.on( "message", (message:WorkerMessage) => {
    if( message.command === "respond" ){
        const callBackPair = callbackPairs.get( message.requestId! );
        if( callBackPair ){
            const [resolve, reject] = callBackPair;
            if( message.error ){
                reject( message );
            }else{
                resolve( message );
            }
            callbackPairs.delete( message.requestId! );
        }
    }
});

async function getConfiguration( key: string, defaultValue: any ){
    return (await postMessageWithResponse({
        command: "getConfiguration",
        content: { key, defaultValue }
    })).content;
}

async function getOpenFiles() : Promise<string[]> {
    return (await postMessageWithResponse({
        command: "getOpenFiles"
    })).content;
}

async function getWorkspaceFolders() : Promise<{index: number, name: string, uri: Uri}[] | undefined> {
    return (await postMessageWithResponse({
        command: "getWorkspaceFolders"
    })).content;
} 

async function getFileStat( filePath: string ){
    try{
        return (await postMessageWithResponse({
            command: "getFileStat",
            content: { filePath }
        })).content;
    }catch( e ){
        return null;
    }
}


async function getNeedsTraining( bookGroup: string[] ){
    //The way we tell if this book group needs training
    //is to see if any of the modification time of any of the books are
    //after the modification time of the resulting model.

    let lastBookModTime : number | null = null;

    for( const book of bookGroup ){
        const bookStat = await getFileStat( book );
        if( bookStat && (lastBookModTime === null || ( bookStat.mtime > lastBookModTime )) ){
            lastBookModTime = bookStat.mtime;
        }
    }

    //if we couldn't find any books to stat in this group, we don't need to train.
    if( lastBookModTime === null ) return false;

    //path to model
    const modelPath = bookGroupToModelName( bookGroup );
    if( modelPath ){
        const modelStat = await getFileStat( modelPath );
        //if there is no model we need to train
        if( !modelStat ) return true;
        //and if a book has been modified after the model we need to train
        if( lastBookModTime === null || ( modelStat.mtime < lastBookModTime )) return true;
    }

    return false;
}

async function trainModelForBookGroup( data: TTrainingAndTestingData ){


    //Convert the data into the structure which the training model expects.
    const sourceVersesTokenized : {[reference: string]: Token[] } = {};
    const targetVersesTokenized : {[reference: string]: Token[] } = {};
    const alignments: {[reference: string]: Alignment[] } = {};
    Object.entries(data.alignments).forEach(([reference,training_data])=>{
        // sourceVersesTokenized[reference] = wordmapLexer.tokenize(training_data.sourceVerse);
        // targetVersesTokenized[reference] = wordmapLexer.tokenize(training_data.targetVerse);
        sourceVersesTokenized[reference] = training_data.sourceVerse.map( n => new Token(n) );
        targetVersesTokenized[reference] = training_data.targetVerse.map( n => new Token(n) );
        updateTokenLocations(sourceVersesTokenized[reference]);
        updateTokenLocations(targetVersesTokenized[reference]);
    
        
        alignments[reference] = training_data.alignments.map(alignment=>new Alignment( new Ngram( alignment.sourceNgram.map( n => new Token(n) ) ), new Ngram( alignment.targetNgram.map( n => new Token(n) )  ) ) );
    });
    
    
    const sourceCorpusTokenized : {[reference: string]: Token[] } = {};
    const targetCorpusTokenized : {[reference: string]: Token[] } = {};
    Object.entries(data.corpus).forEach(([reference,training_data])=>{
        sourceCorpusTokenized[reference] = training_data.sourceTokens.map( n => new Token(n) );
        targetCorpusTokenized[reference] = training_data.targetTokens.map( n => new Token(n) );
        updateTokenLocations(sourceCorpusTokenized[reference]);
        updateTokenLocations(targetCorpusTokenized[reference]);
    });
    
    
    //TODO: break the hyper parameters of MorphJLBoostWordMap out into configuration options.

    //Create the training object.
    //There are several different word map classes,
    //and there are different hyper parameters which can be passed into it as well.
    const wordAlignerModel = new MorphJLBoostWordMap({ targetNgramLength: 5, warnings: false, forceOccurrenceOrder:false, train_steps:1000 });

    //TODO: make this also a configuration option.
    wordAlignerModel.setTrainingRatio( .1 );

    wordAlignerModel.appendKeyedCorpusTokens(sourceCorpusTokenized,targetCorpusTokenized);
    //Do a test to see if adding the alignment stuff as corpus as well helps.
    wordAlignerModel.appendKeyedCorpusTokens(sourceVersesTokenized,targetVersesTokenized);
    
    await wordAlignerModel.add_alignments_2(sourceVersesTokenized,targetVersesTokenized,alignments);

    return wordAlignerModel;

}

async function trainBookGroup( bookGroup: string[] ){
    //first load in the different books which actually exist.

    //I could make this go through the message passing and have vscode load the book,
    //but I really don't want to cause any lagging on the vscode side, so I am going
    //to load this with fs directly and when/if this gets turned into a web plugin,
    //this decision can be reverted.

    //drop any book that is not found.  If an exception is thrown don't include the book.
    const codexContent: { [filename: string]: string } = bookGroup.reduce((acc: { [filename: string]: string }, filename: string) => {
        try {
            const content = fs.readFileSync(filename).toString();
            acc[filename] = content;
        } catch {
            // File not found or unable to read
        }
        return acc;
    }, {});

    //wrap the configuration getter so that it doesn't have a second parameter.
    const getConfigurationWrapper = async ( key : string ) => await getConfiguration( key, null );

    //now get the workspace folders
    const workSpaceFolders = await getWorkspaceFolders() ?? [];
    if( workSpaceFolders.length === 0 ){
        throw new Error( "no workspace folders" );
    }
    const firstWorkspaceFolder = workSpaceFolders[0].uri.path;

    const bookAlignments: TTrainingAndTestingData = await Object.entries(codexContent).reduce(async (promiseAccumulator: Promise<TTrainingAndTestingData>, [filename, content]: [string, string]) => {
        const accumulator = await promiseAccumulator;
        const currentValue = await getAllAlignmentDataFromCodexBook(filename, content, getConfigurationWrapper, firstWorkspaceFolder);
        if (currentValue === undefined) return accumulator;

        //I don't want to have collisions between the new references and the ones
        //already in the accumulator.
        const referenceRemap : { [reference: string]: string } = {};
        
        //first collect all the references and remove duplicates.
        const references = Object.keys(currentValue.alignments).concat(Object.keys(currentValue.corpus)).filter((value, index, array) => array.indexOf(value) === index);

        //now remap the references
        references.forEach((reference) => {
            if( reference in accumulator.alignments || reference in accumulator.corpus ){
                //already exists
                let prefixNumber = 1;
                let newReference = `${prefixNumber} ${reference}`;
                while( newReference in accumulator.alignments || newReference in accumulator.corpus ){
                    prefixNumber++;
                    newReference = `${prefixNumber} ${reference}`;
                }
                referenceRemap[reference] = newReference;
            }else{
                referenceRemap[reference] = reference;
            }
        });

        //change the references in the alignments and corpus
        const remappedAlignments = Object.fromEntries( Object.entries(currentValue.alignments).map( ([k, v]) => [referenceRemap[k], v] ) );
        const remappedCorpus     = Object.fromEntries( Object.entries(currentValue.corpus    ).map( ([k, v]) => [referenceRemap[k], v] ) );


        return {
            alignments: { ...accumulator.alignments, ...remappedAlignments },
            corpus:     { ...accumulator.corpus    , ...remappedCorpus     }
        };
    }, Promise.resolve({ alignments: {}, corpus: {} }));

    //now filter out incomplete alignments so that we don't train on incomplete work.
    bookAlignments.alignments = Object.fromEntries( Object.entries(bookAlignments.alignments).filter( ([reference,verseData]) => {
        //return true if every alignment in verseData.alignments has a non zero length target.
        return Object.values(verseData.alignments).every( (alignment) => {
            return alignment.targetNgram.length > 0;
        });
    }));


    const modelPath = bookGroupToModelName( bookGroup );
    if( Object.values(bookAlignments.alignments).length === 0 ){
        throw new Error( "No alignments in book group " + modelPath );
    }

    //Do the actual training.
    console.log( "worker: Training...");

    const model = await trainModelForBookGroup( bookAlignments );
    console.log( "worker: Training complete." );

    //save the model
    if( modelPath ){
        const replaceModel = async () : Promise<void> =>   {
            const tempPath = modelPath + ".tmp";
            const dir = path.dirname(modelPath);
            //model save returns a jason-able structure which then needs to be saved to the path.
            //I would also like to gzip it on the way out because we can and that will save space.
            const modelJson = JSON.stringify( model.save() );
            //now gzip the string.
            const gzip = zlib.createGzip({level: 9});
            const gzipStream = gzip.pipe(fs.createWriteStream( tempPath ));

            try {
                await fs.promises.mkdir(dir, {recursive: true});
            } catch (err) {
                console.error( `Error creating directory: ${err}` );
                throw err;
            }

            return new Promise<void>( (resolve, reject) => {
                gzipStream.on('finish', () => {
                    //now move the temp file to the model path
                    fs.promises.rename(tempPath, modelPath)
                    .then(resolve)
                    .catch(reject); // Directly pass error to rejection
                });
                gzipStream.on('error', (err) => {
                    console.error( `Error writing gzip file: ${err}` );
                    reject(err);
                });
                gzip.write( modelJson );
                gzip.end();
            });
        };
    
        await replaceModel();
    }
}

async function trainModels(){
    let done = false;

    while( !done ){
        const enabled = await getConfiguration( "alignmentTraining.enabled", true );
        if( enabled ){
            //we mark that we are done before we start, but if we find any work
            //to do we will set it to false again.
            done = true;

            const bookGroups : string[][] | undefined = await getBookGroups(
                getConfiguration,getWorkspaceFolders,getOpenFiles);
                
            if( bookGroups !== undefined ){
                for( const bookGroup of bookGroups ){
                    const needsTraining = await getNeedsTraining( bookGroup );
                    if( needsTraining ){
                        try{
                            console.log( "worker: training group: " + bookGroupToModelName( bookGroup ) );
                            await trainBookGroup( bookGroup );
                            console.log( "worker: done training group: " + bookGroupToModelName( bookGroup ) );
                            done = false;
                        }catch( e ){
                            console.log( "worker: error: " + e );
                        }
                    }
                }
            }
        }else{
            done = true;
        }
    }
}


console.log( "worker: in the worker" );

trainModels().then( () => {
    console.log( "worker: done" );
    //timeout is needed or the log doesn't show up.
    setTimeout(process.exit, 100);
} ).catch( e => {
    console.log( "worker: error: " + e );
    setTimeout(process.exit, 100);
});
