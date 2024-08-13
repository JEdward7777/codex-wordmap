import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import * as zlib from 'zlib';
import { Uri, WorkspaceFolder } from "vscode";
import { PRIMARY_WORD, Perf, PerfVerse, SECONDARY_WORD, TSourceTargetAlignment, TTrainingAndTestingData, TWord, extractAlignmentsFromPerfVerse, extractWrappedWordsFromPerfVerse, getSourceFolders, pullVersesFromPerf, reindexPerfVerse, sortAndSupplementFromSourceWords, usfmToPerf } from './utils';
import { AbstractWordMapWrapper } from 'wordmapbooster/dist/boostwordmap_tools';


function computeSourceFilenames(filename: string, sourceFolders: string[]): string[] {

    const transformedFilenames: string[] = [];

    //if sourceFolders is a string wrap it in an array.
    if (typeof sourceFolders === 'string') { sourceFolders = [sourceFolders]; }

    for (const sourceFolder in sourceFolders) {
        //get the filename without the path from filename:
        const filenameWithoutPath = path.basename(filename);

        //now concatenate that onto the sourceFolder path.
        transformedFilenames.push(path.join(sourceFolders[sourceFolder], filenameWithoutPath));
    }
    //return all the matches.
    return transformedFilenames;
}

function getFileInWorkspace( filePath: string, firstWorkSpaceFolder: string ): Promise< string | undefined > {
    //const firstWorkSpaceFolder = vscode.workspace?.workspaceFolders?.[0]?.uri.fsPath;
    const filePathRebased = firstWorkSpaceFolder ? path.resolve(firstWorkSpaceFolder, filePath) : filePath;

    return new Promise( (resolve, reject) => {
        fs.readFile(filePathRebased, 'utf8', (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}


async function getFirstValidFile( filenames: string[], firstWorkSpaceFolder: string ) : Promise<string | undefined> {
    for( const filename of filenames ){
        try{
            let fileContent = await getFileInWorkspace( filename, firstWorkSpaceFolder );
            if( fileContent ){
                return fileContent;
            }
        }catch( e ){
            //ignore
        }
    }
    return undefined;
}


export async function getSourceFileForTargetFile( 
        filename: string, 
        getConfiguration: (key: string) => Promise<any>, 
        firstWorkSpaceFolder: string ) : Promise< string | undefined > {
    let result = undefined;
    const baseFilename = path.basename(filename);
    

    let sourceFolders = await getSourceFolders(getConfiguration);    
    let sourceFilenames = computeSourceFilenames( filename, sourceFolders );
    result = await getFirstValidFile( sourceFilenames, firstWorkSpaceFolder );

    if( result === undefined ){
        //Throw an exception indicating that we can't find the file.
        throw new Error(`Could not find source file for ${baseFilename}`);
    }
    return result;
}




function codexToPerf( codexFileContents: string ): Perf | undefined {
    //parse the codex as json.
    const codexJson = JSON.parse(codexFileContents);

    for( const cell of codexJson.cells ){
        if( cell?.metadata?.perf ){
            return cell?.metadata?.perf as Perf;
        }
    }   

    return undefined;
}


function getSourceFileForTargetCodexFile(codexFileContents: string): string | undefined {
    const codexJson = JSON.parse(codexFileContents);

    for( const cell of codexJson.cells ){
        if( cell?.metadata?.wordmapSettings?.sourceMapping ){
            return cell?.metadata?.wordmapSettings?.sourceMapping;
        }
    }
    
    return undefined;
}

export async function getAllAlignmentDataFromCodexBook( filename: string, codexFileContents: string, 
    getConfiguration: (key: string) => Promise<any>,
    firstWorkSpaceFolder: string ): Promise< TTrainingAndTestingData | undefined >{

    //TODO: Check if this throws an exception or returns null if it can't find the source files.
    const sourceUsfmPath = getSourceFileForTargetCodexFile( codexFileContents );
    if( sourceUsfmPath === undefined ) return undefined;

    const sourceUsfmData = fs.readFileSync( sourceUsfmPath, 'utf8' );
    const sourceUsfmPerf : Perf = usfmToPerf( sourceUsfmData );

    const targetUsfmPerf : Perf | undefined  = codexToPerf( codexFileContents );
    if( targetUsfmPerf === undefined ) return undefined;


    //use the file name without the path and the suffix as the book name.
    const bookName = path.basename(filename).split(".")[0];

    const sourceVerses : { [key: string]: PerfVerse} = pullVersesFromPerf( sourceUsfmPerf );
    const targetVersesNotReindexed : { [key: string]: PerfVerse} = pullVersesFromPerf( targetUsfmPerf );


    const targetVerses : { [key: string]: PerfVerse} = Object.fromEntries( Object.entries( targetVersesNotReindexed ).map( ([reference,targetVerseNotReindexed]: [string, PerfVerse]) => {
        const targetVerse = reindexPerfVerse( targetVerseNotReindexed );
        return [reference, targetVerse];
    }));

    const bookAlignments : { [key: string]: TSourceTargetAlignment[] } = Object.fromEntries( Object.entries( targetVerses ).map( ([reference,targetVerse]: [string, PerfVerse]) => {
        const alignments = extractAlignmentsFromPerfVerse( targetVerse );
        return [reference, alignments];
    }));


    const sourceWordsPerVerse = Object.fromEntries( Object.entries( sourceVerses ).map( ([reference,sourceVerse]: [string, PerfVerse]) => {
        const sourceWords = extractWrappedWordsFromPerfVerse( sourceVerse, PRIMARY_WORD );
        return [reference, sourceWords];
    }));

    const supplementedAlignmentsPerVerse = Object.fromEntries( Object.entries( bookAlignments ).map( ([reference,alignments]: [string, TSourceTargetAlignment[]]) => {
        const sourceWords = sourceWordsPerVerse[reference] ?? [];
        const supplementedAlignments = sortAndSupplementFromSourceWords( sourceWords, alignments );
        return [reference, supplementedAlignments];
    }));

    //Now create the data structure which will be stuffed with the result.
    const result : TTrainingAndTestingData = {
        alignments: {},
        corpus: {},
    };

    //now loop through all the data and stuff it into the result.
    Object.entries( supplementedAlignmentsPerVerse ).forEach( ([reference,supplementedAlignments]: [string, TSourceTargetAlignment[]]) => {
        const expandedReference = `${bookName} ${reference}`;

        const tWordTargetVerse: TWord[] = extractWrappedWordsFromPerfVerse( targetVerses[reference], SECONDARY_WORD );
        const tWordSourceVerse: TWord[] = extractWrappedWordsFromPerfVerse( sourceVerses[reference], PRIMARY_WORD );
        result.corpus[expandedReference] = {
            sourceTokens: tWordSourceVerse,
            targetTokens: tWordTargetVerse
        };

        //only add it to the alignments if the alignment is complete so that we don't train on incomplete alignments.
        const hasEmptySourceNgram = supplementedAlignments.some( (supplementedAlignment: TSourceTargetAlignment) => {
            return supplementedAlignment.sourceNgram.length === 0;
        });
        
        if( !hasEmptySourceNgram ){
            result.alignments[expandedReference] = {
                targetVerse: tWordTargetVerse,
                sourceVerse: tWordSourceVerse,
                alignments: supplementedAlignments,
            };
        }
    });

    return result;
}



export function bookGroupToModelName( bookGroup: string[] ){
    //The output will have the same path as the first entry.
    //The name will have the first entry to the second entry (unless it is just one entry)
    //Plus 4 characters of a hash of the entire string joined with \n's.
    //We only need a hash if there are more then two to represent the missing books.
    //The point is that if any of the books are to change, the name of the model would change.

    if( bookGroup.length === 0 ) return undefined;

    const firstEntry = bookGroup[0];

    const pathOfFirstEntry = path.dirname( firstEntry );

    //Strip off the suffix.
    const nameOfFirstEntry = path.basename( firstEntry ).split(".")[0];
    const nameOfLastEntry = path.basename( bookGroup[bookGroup.length-1] ).split(".")[0];

    let result = nameOfFirstEntry;
    if( bookGroup.length > 2 ){
        result += "_to_";
    }else if( bookGroup.length > 1 ){
        result += "_";
    }
    if( bookGroup.length > 1 ) result += nameOfLastEntry;

    if( bookGroup.length > 2 ){
        const fullStringJoin = bookGroup.join( "\n" );
        const hash = crypto.createHash( "md5" );
        hash.update( fullStringJoin );
        result += "_" + hash.digest("hex").substring(0, 4);
    }

    //now tack a .model onto the end.
    result += ".model";

    //and put the path on the front.
    //see if pathOfFirstEntry ends with "target" using basename
    const model_folder = path.basename( pathOfFirstEntry ) === "target" ? path.join(path.dirname( pathOfFirstEntry ), "models" ) : pathOfFirstEntry;

    //stick the resulting model name on the end.
    const revisedPath = path.join( model_folder, result );
    return revisedPath;
}


export async function getBookGroups( 
        getConfiguration: ( key: string, defaultValue: string ) => Promise<string>,
        getWorkspaceFolders: () => Promise<readonly WorkspaceFolder[]| undefined>,
        getOpenFiles: () => Promise<string[]>){
    const bookGroupsString = await getConfiguration( "alignmentTraining.bookGroups", "" );

    const workspaceFolders = await getWorkspaceFolders() ?? [];
    
    //now I will split the book groups into groups, split by blank lines.
    const bookGroups : string[][] = [];

    //only process the bookGroups if we have some workspaceFolders.
    if( workspaceFolders.length === 0 ){
        return bookGroups;
    }

    
    const lines = bookGroupsString.split( "\n" );
    let currentGroup : string[] = [];
    for( const line of lines ){
        if( line.trim().startsWith( "#" ) ){
            //ignore comments
        }else if( line.trim() ){
            currentGroup.push( line );
        }else{
            if( currentGroup.length > 0 ){
                bookGroups.push( currentGroup );
                currentGroup = [];
            }
        }
    }
    if( currentGroup.length > 0 ){
        bookGroups.push( currentGroup );
        currentGroup = [];
    }

    //Now I need to path join these with the first folder in the workspace.
    for( let i = 0; i < bookGroups.length; i++ ){
        bookGroups[i] = bookGroups[i].map( b => {
            const basePath = path.join( workspaceFolders[0].uri.path, "files", "target" );
            let joined = path.join( basePath, b );
            if( !joined.toLowerCase().endsWith(".codex") ){
                joined += ".codex";
            }
            return joined;
        }).map( b => path.normalize( b ) );
    }

    //now see if the usfm files which are currently open are represented, otherwise add each of them as their own group.
    const openFiles = (await getOpenFiles()).map( f => path.normalize( f ) );
    for( const openFile of openFiles ){
        if( !bookGroups.some( b => b.includes( openFile ) ) ){
            bookGroups.push( [openFile] );
        }
    }

    return bookGroups;
}


export async function filenameToBookGroup( filename: string,
        getConfiguration: ( key: string, defaultValue: string ) => Promise<string>,
        getWorkspaceFolders: () => Promise<readonly WorkspaceFolder[]| undefined>,
        getOpenFiles: () => Promise<string[]> ) : Promise<string[] | undefined> {
    const bookGroups = await getBookGroups( getConfiguration, getWorkspaceFolders, getOpenFiles );
    //convert the bookGroups into canonical paths.
    const bookGroupsCanonical = bookGroups.map( b => b.map( f => path.normalize( f ) ) );
    const filenameCanonical = path.normalize( filename );

    //need to see if we can find the filenameCanonical in any of the bookGroupsCanonical
    //But we have to return the original non-canonical path.
    //iterate over bookGroupsCanonical but have the index in the loop.
    for( let i = 0; i < bookGroupsCanonical.length; i++ ){
        if( bookGroupsCanonical[i].includes( filenameCanonical ) ){
            return bookGroups[i];
        }
    }
    return undefined;
}

/**
 * Loads and decompresses a JSON file.
 *
 * @param {string} filename - The name of the file to load and decompress
 * @return {Promise<any>} A promise that resolves with the parsed JSON data
 */
export function loadAndDecompressJSON(filename: string): Promise<any> {
    return new Promise((resolve, reject) => {
        fs.readFile(filename,(err, data) => {
            if (err) {
                reject(err);
                return;
            }

            zlib.gunzip(data, (err, decompressedData) => {
            
                if (err) {
                    reject(err);
                    return;
                }

                try {
                    const jsonData = JSON.parse(decompressedData.toString());
                    resolve(jsonData);
                } catch (error) {
                    reject(error);
                }
            });
        });
    });
}

export async function loadAlignmentModel( modelPath: string ) : Promise<{model: AbstractWordMapWrapper, file_modification_time: number}> {
    //load the filename,
    //and then decompress it as a gzip
    //and then decode it as JSON.
    //and then pass it to AbstractWordMapWrapper.load
    const modelJson = await loadAndDecompressJSON( modelPath );
    const model = AbstractWordMapWrapper.load( modelJson );

    const stat = await fs.promises.stat( modelPath );
    return { model, file_modification_time: stat.mtimeMs };
}