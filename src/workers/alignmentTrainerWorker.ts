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
import { CodexNotebookAsJSONData } from "../CodexFileformat";
import { shuffleArray } from "wordmapbooster/dist/misc_tools";

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
    console.log( "crashDebug: trainModelForBookGroup .1 ..." );


    //Convert the data into the structure which the training model expects.
    let sourceVersesTokenized : {[reference: string]: Token[] } = {};
    let targetVersesTokenized : {[reference: string]: Token[] } = {};
    let alignments: {[reference: string]: Alignment[] } = {};
    Object.entries(data.alignments).forEach(([reference,training_data])=>{
        // sourceVersesTokenized[reference] = wordmapLexer.tokenize(training_data.sourceVerse);
        // targetVersesTokenized[reference] = wordmapLexer.tokenize(training_data.targetVerse);
        sourceVersesTokenized[reference] = training_data.sourceVerse.map( n => new Token(n) );
        targetVersesTokenized[reference] = training_data.targetVerse.map( n => new Token(n) );
        updateTokenLocations(sourceVersesTokenized[reference]);
        updateTokenLocations(targetVersesTokenized[reference]);
    
        
        alignments[reference] = training_data.alignments.map(alignment=>new Alignment( new Ngram( alignment.sourceNgram.map( n => new Token(n) ) ), new Ngram( alignment.targetNgram.map( n => new Token(n) )  ) ) );
    });
    
    
    let sourceCorpusTokenized : {[reference: string]: Token[] } = {};
    let targetCorpusTokenized : {[reference: string]: Token[] } = {};
    Object.entries(data.corpus).forEach(([reference,training_data])=>{
        sourceCorpusTokenized[reference] = training_data.sourceTokens.map( n => new Token(n) );
        targetCorpusTokenized[reference] = training_data.targetTokens.map( n => new Token(n) );
        updateTokenLocations(sourceCorpusTokenized[reference]);
        updateTokenLocations(targetCorpusTokenized[reference]);
    });


    //TODO: break the hyper parameters of MorphJLBoostWordMap out into configuration options.
    //The max alignments sets should also be a configurable option.

    //make alignment sets.
    //worked 1600  3200 didn't work.

    //now with corpus being 1.5 as big
    //1600 didn't work.  800 didn't work.  400 didn't work.
    //200 did work.

    //Now I am testing again with the corpus being set to the same size.
    //Testing at 800.  Worked.  Testing 1600.  Worked.
    //Testing 3200.  Didn't work.
    //Going back to 1600 and then am going to crank back up the other settings for training.
    //I set the training steps to 1000.  Going to verify this works before increasing the 
    //percentage to keep back up to .1 .
    //Didn't work.  Decreasing maxAlignmentSets to 800.  Didn't work.
    //400 worked.  Ok, now going to increase the .01 back up to .1.
    //That worked.
    const maxAlignmentSets = 400;
    console.log( "crashDebug: maxAlignmentSets ", maxAlignmentSets );
    if (Object.keys(alignments).length > maxAlignmentSets) {
        //shuffle the alignments and then take the first target_max_alignments
        var alignmentsAsArray = Object.entries(alignments);
        //randomize using shuffle function
        shuffleArray(alignmentsAsArray);
        //take the first target_max_alignments
        alignments = Object.fromEntries(alignmentsAsArray.slice(0, maxAlignmentSets));
    }


    const randomKeyForReference: { [reference: string]: number } = {};
    const abSortFavoringKeptAlignments = (a: [string, Token[]], b: [string, Token[]]) => {
        //if a is in the alignments and not b then return -1
        if (alignments[a[0]] && !alignments[b[0]]) {
            return -1;
        }
        //if b is in the alignments and not a then return 1
        if (alignments[b[0]] && !alignments[a[0]]) {
            return 1;
        }

        //if either reference is not in the random key set, then add a new random number for the entry.
        if (!randomKeyForReference[a[0]]) {
            randomKeyForReference[a[0]] = Math.random();
        }
        if (!randomKeyForReference[b[0]]) {
            randomKeyForReference[b[0]] = Math.random();
        }

        //if both are in the alignments then return the difference of the random key.
        return randomKeyForReference[a[0]] - randomKeyForReference[b[0]];
    };
    

    //This function takes a corpus and filters it so that only the references
    //that are still in the alignments are left in the corpus.
    //const maxCorpusSets = maxAlignmentSets*1.5;
    const maxCorpusSets = maxAlignmentSets;
    function filterDownToSpecificLimitFavoringAlignmentRefs( toFilter: {[reference: string]: Token[] } ): {[reference: string]: Token[] } {
        if (Object.keys(toFilter).length <= maxCorpusSets) {
            return toFilter;
        }
        //do a favored sort on the toFilter items.
        const sorted = Object.entries(toFilter).sort(abSortFavoringKeptAlignments);

        //now get a result that is a slice from the sorted array.
        const result = sorted.slice(0, maxCorpusSets);

        //now create a new object from the result.
        return Object.fromEntries(result);
    }
    sourceCorpusTokenized = filterDownToSpecificLimitFavoringAlignmentRefs(sourceCorpusTokenized);
    targetCorpusTokenized = filterDownToSpecificLimitFavoringAlignmentRefs(targetCorpusTokenized);
    sourceVersesTokenized = filterDownToSpecificLimitFavoringAlignmentRefs(sourceVersesTokenized);
    targetVersesTokenized = filterDownToSpecificLimitFavoringAlignmentRefs(targetVersesTokenized);

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


    console.log( "crashDebug: trainModelForBookGroup complete" );

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

    const bookAlignments: TTrainingAndTestingData = await Object.entries(codexContent).reduce(async (promiseAccumulator: Promise<TTrainingAndTestingData>, [filename, contentAsString]: [string, string]) => {
        const accumulator = await promiseAccumulator;
        const codexData : CodexNotebookAsJSONData = JSON.parse(contentAsString) as CodexNotebookAsJSONData;
        const currentValue = await getAllAlignmentDataFromCodexBook(filename, codexData, getConfigurationWrapper, firstWorkspaceFolder);
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
    console.log( "crashDebug: worker: Training...");

    const model = await trainModelForBookGroup( bookAlignments );
    console.log( "crashDebug: worker: Training complete." );

    //Await a 5 second sleep so that gc can possibly free up some memory.
    console.log( "crashDebug: worker: Sleeping for 5 seconds..." );
    await new Promise(resolve => setTimeout(resolve, 5000));

    //save the model
    console.log( "crashDebug: worker: Saving model..." );
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
    
        console.log( "crashDebug: worker: saving model..." );
        await replaceModel();
        console.log( "crashDebug: worker: saved model." );
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
    console.log( "worker: error: ", e );
    setTimeout(process.exit, 100);
});
