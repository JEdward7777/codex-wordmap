import * as vscode from "vscode";
import { getPerfFromActiveNotebook, getPerfFromNotebookSingleVerseOptimized, readUsfmData, updatePerfOnNotebook } from "./usfmStuff/importUsfm";
import { PRIMARY_WORD, Perf, SECONDARY_WORD, TAlignmentPackage, TSourceTargetAlignment, TWord, extractAlignmentsFromPerfVerse, extractWrappedWordsFromPerfVerse, pullVerseFromPerf, reindexPerfVerse, replaceAlignmentsInPerfInPlace, sortAndSupplementFromSourceWords } from "./usfmStuff/utils";
import { showWordAlignWebview } from "./wordAlignWebview";
import { Worker } from 'node:worker_threads';
import { WorkerMessage } from './workers/alignmentTrainerTypes';
import * as path from 'path';

export function getSourceUri( notebookDocument: vscode.NotebookDocument ) : string | undefined {
    for( const cell of notebookDocument.getCells() ) {
        if (cell.kind === vscode.NotebookCellKind.Markup) {
            if( cell?.metadata?.wordmapSettings?.sourceMapping ) {
                return cell?.metadata?.wordmapSettings?.sourceMapping;
            }
        }
    }
    return undefined;
}

export async function setSourceUri( notebook: vscode.NotebookDocument, sourceUri: string ) {
    let cellEdit: vscode.NotebookEdit | null = null;

    // Iterate over each cell to find the ones with existing metadata
    for (let i = 0; i < notebook.cellCount && cellEdit === null; i++) {
        const cell = notebook.cellAt(i);
        if (cell.kind === vscode.NotebookCellKind.Markup) {
            if (cell.metadata?.perf) {
                // Create a new metadata object with the updated setting
                const newMetadata = {
                    ...cell.metadata,
                    wordmapSettings: {
                        ...cell.metadata?.wordmapSettings,
                        sourceMapping: sourceUri
                    }
                };

                // Create a notebook edit to update the cell's metadata
                cellEdit = vscode.NotebookEdit.updateCellMetadata(i, newMetadata);
            }
        }
    }

    // If we still didn't find the cell with existing metadata, go ahead and search through
    // all the cells and find the first one which is referencing a chapter which should be Chapter 1.
    for( let i = 0; i < notebook.cellCount && cellEdit === null; i++ ){
        const cell = notebook.cellAt(i);
        if( cell.kind === vscode.NotebookCellKind.Markup ){
            //Test if the cell's contents starts with "# Chapter"
            if( cell.document.getText().startsWith("# Chapter") ){ 
                cellEdit = vscode.NotebookEdit.updateCellMetadata(i, {
                    ...cell.metadata,
                    wordmapSettings: {
                        ...cell.metadata?.wordmapSettings,
                        sourceMapping: sourceUri
                    }
                });
            }
        }
    }

    // Apply the edit to the notebook
    if( cellEdit !== null ){
        const edit = new vscode.WorkspaceEdit();
        edit.set(notebook.uri, [cellEdit]);
        await vscode.workspace.applyEdit(edit);
    }
}

async function getAlignmentData( targetPerf: Perf, sourcePerf: Perf, reference: string ): Promise< TAlignmentPackage | undefined >{
    //Make the arguments are happy
    if( !reference ) return undefined;
    if( !targetPerf ) return undefined;
    if( !sourcePerf ) return undefined;

    //convert the reference book, and chapter:verse.
    const [book, chapterVerseRef] = reference.split(" ");
    //return if ":" is not in chapterVerse.
    if( !chapterVerseRef.includes(":") ) return undefined;


    //get the source and target verses
    const sourceVerse = pullVerseFromPerf( chapterVerseRef, sourcePerf );
    const targetVerseNotReindexed = pullVerseFromPerf( chapterVerseRef, targetPerf );
    if( !sourceVerse || !targetVerseNotReindexed ) return undefined;

    //reindex the target verse
    const targetVerse = reindexPerfVerse( targetVerseNotReindexed );

    //extract the alignments
    const sourceWords = extractWrappedWordsFromPerfVerse( sourceVerse, PRIMARY_WORD );
    const targetWords = extractWrappedWordsFromPerfVerse( targetVerse, SECONDARY_WORD );
    const alignments = extractAlignmentsFromPerfVerse( targetVerse );

    //sort and supplement the alignments
    const supplementedAlignments = sortAndSupplementFromSourceWords( sourceWords, alignments );
    
    return {wordBank: targetWords, alignments: supplementedAlignments, reference};
}


const usfmPerfCache = new Map<string, {perf:Perf, timestamp: number}>();
export async function cachedReadUsfmAsPerf( uri_string: string ): Promise<Perf | undefined> {
    const uri = vscode.Uri.file( uri_string );

    //check if the file exists
    const file_timestamp = await vscode.workspace.fs.stat( uri );
    //if the file doesn't exist, return undefined
    if( !file_timestamp ) return undefined;

    //check if the file is in the cache
    if( usfmPerfCache.has( uri_string ) ) {
        //check if the file is newer than the cache
        const { perf, timestamp } = usfmPerfCache.get( uri_string )!;
        //if the file is newer than the cache, return the perf
        if( file_timestamp.mtime <= timestamp ) return perf;
    }

    //if the file is not in the cache, read the file and return the perf
    const perf = Object.values(await readUsfmData( [uri] ))[0];

    //store the perf in the cache
    usfmPerfCache.set( uri_string, { perf, timestamp: file_timestamp.mtime } );

    //return the perf
    return perf;
}

/**
 * Executes the codex word mapping functionality.
 *
 * @param {vscode.ExtensionContext} context - The extension context.
 * @param {vscode.NotebookDocument} notebookDocument - The notebook document.
 * @param {string} verseRef - The verse reference.
 * @return {Promise<void>} A promise that resolves when the function completes.
 */
export async function doCodexWordMapping( context: vscode.ExtensionContext, notebookDocument: vscode.NotebookDocument, verseRef: string ) {

    //verify that the current document has a source file specified.
    const sourceMapping : string | undefined = getSourceUri( notebookDocument );
    if( !sourceMapping ) {
        //pop up an information message
        vscode.window.showInformationMessage( "Please connect a source file using the 'Connect Source USFM' command." );
        return;
    }

    //Get the perf from the active notebook.
    let targetPerf = await getPerfFromNotebookSingleVerseOptimized( notebookDocument, verseRef );
    if( !targetPerf ) return;

    //get the perf for the source document.
    // const sourceUri = vscode.Uri.parse( sourceMapping );
    // const usfmDictionary = await readUsfmData( [sourceUri] );
    // const sourcePerf = Object.values(usfmDictionary)[0];
    let sourcePerf : Perf | undefined = undefined;
    try{
        sourcePerf = await cachedReadUsfmAsPerf( sourceMapping );
    }catch(e){
       //rethrow this error with a better message
        vscode.window.showErrorMessage( `Missing source. Please connect with 'Connect Source USFM' command.` ); 
    }
    if( !sourcePerf ) return;


    //extract the alignments supplemented by the source document.
    const alignmentInfo = await getAlignmentData( targetPerf, sourcePerf, verseRef );

    //call the webview to display the alignments.
    if( !alignmentInfo ) return;
    const modifiedAlignments : TSourceTargetAlignment[] | undefined = await showWordAlignWebview( context, alignmentInfo, notebookDocument.uri );
    if( !modifiedAlignments ) return;

    //get the perf from the active document again in case it changed while the webview was open.
    targetPerf = await getPerfFromNotebookSingleVerseOptimized( notebookDocument, verseRef );
    if( !targetPerf ) return;

    //find the chapter and verse from the reference.
    const [book, chapterVerseRef] = verseRef.split(" ");
    const [chapterStr, verseStr] = chapterVerseRef.split(":");
    if( !chapterStr || !verseStr ) return;
    const chapter = parseInt( chapterStr );
    const verse = parseInt( verseStr );

    //take the alignments returned by the webview and update the perf.
    replaceAlignmentsInPerfInPlace( targetPerf, chapter, verse, modifiedAlignments );

    //modify the document with the new perf.
    await updatePerfOnNotebook( notebookDocument, targetPerf );
}

let alignmentTrainerWorker: Worker | null = null;

async function startAlignmentTrainer(){
    //Check if alignment training is enabled in the config
    if( vscode.workspace.getConfiguration('codex-wordmap').get('alignmentTraining.enabled', true) ){
 

        //Test if it's already running.
        if( alignmentTrainerWorker === null ){
            console.log( "starting alignment trainer worker" );
            alignmentTrainerWorker = new Worker(path.join(__dirname, "./alignmentTrainerWorker.js"));

            alignmentTrainerWorker.on('exit', (code) => {
                console.log( "alignment trainer worker exited with code " + code );
                alignmentTrainerWorker = null;
            });

            alignmentTrainerWorker.on('message', async (message: WorkerMessage) => {
                try{
                    if( message.command === "getConfiguration" ){
                        alignmentTrainerWorker?.postMessage({
                            command: "respond",
                            requestId: message.requestId,
                            content: vscode.workspace.getConfiguration('codex-wordmap').get(message.content.key, message.content.defaultValue)
                        });
                    }else if( message.command === "getOpenFiles" ){
                        const openNotebooks = vscode.workspace.notebookDocuments.filter( n => n.notebookType === 'codex-type' );
                        const openFiles = openNotebooks.map( n => n.uri.fsPath );
                        alignmentTrainerWorker?.postMessage({
                            command: "respond",
                            requestId: message.requestId,
                            content: openFiles
                        });
                    }else if( message.command === "getWorkspaceFolders" ){
                        alignmentTrainerWorker?.postMessage({
                            command: "respond",
                            requestId: message.requestId,
                            content: vscode.workspace.workspaceFolders
                        });
                    }else if( message.command === "getFileStat" ){
                        const stat = await vscode.workspace.fs.stat( vscode.Uri.file( message.content.filePath ) );
                        alignmentTrainerWorker?.postMessage({
                            command: "respond",
                            requestId: message.requestId,
                            content: stat
                        });
                    }
                }catch ( e ){
                    if( message.requestId ){
                        alignmentTrainerWorker?.postMessage({
                            command: "respond",
                            requestId: message.requestId,
                            content: null,
                            error: e
                        });
                    }
                }
            });
        }else{
            console.log( "alignment trainer worker already running" );
        }

    }else{
        console.log( "alignment training not enabled" );
    }
}

export function registerCodexOnSaveHook( context: vscode.ExtensionContext ) {
    context.subscriptions.push(vscode.workspace.onDidSaveNotebookDocument((e) => {
		if( e.notebookType === 'codex-type' ){

            //sleep for a second to allow the save to finish
            setTimeout(async () => {

                 startAlignmentTrainer();
            }, 1000);
		}
	}));
}