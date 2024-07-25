import * as vscode from "vscode";
import { getPerfFromActiveNotebook, readUsfmData } from "./usfmStuff/importUsfm";
import { PRIMARY_WORD, Perf, SECONDARY_WORD, TSourceTargetAlignment, TWord, extractAlignmentsFromPerfVerse, extractWrappedWordsFromPerfVerse, pullVerseFromPerf, reindexPerfVerse, replaceAlignmentsInPerfInPlace, sortAndSupplementFromSourceWords } from "./usfmStuff/utils";
import { showWordAlignWebview } from "./wordAlignWebview";

function getSourceUri( notebookDocument: vscode.NotebookDocument ) : string | undefined {
    for( const cell of notebookDocument.getCells() ) {
        if (cell.kind === vscode.NotebookCellKind.Markup) {
            if( cell?.metadata?.wordmapSettings?.sourceMapping ) {
                return cell?.metadata?.wordmapSettings?.sourceMapping;
            }
        }
    }
    return undefined;
}

async function getAlignmentData( targetPerf: Perf, sourcePerf: Perf, reference: string ): Promise< {wordBank: TWord[], alignments: TSourceTargetAlignment[], reference: string} | undefined >{
    //Make the arguments are happy
    if( !reference ) return undefined;
    if( !targetPerf ) return undefined;
    if( !sourcePerf ) return undefined;

    //convert the reference book, and chapter:verse.
    const [book, chapterVerseRef] = reference.split(" ");
    //return if ":" is not in chatperVerse.
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
        vscode.window.showInformationMessage( "Please connect a source file using the 'Connect Source File' command." );
        return;
    }

    //Get the perf from the active notebook.
    let targetPerf = await getPerfFromActiveNotebook( notebookDocument );

    //get the perf for the source document.
    const sourcePerf = Object.values(readUsfmData( [vscode.Uri.parse( sourceMapping )] ))[0];


    //extract the alignments supplemented by the source document.
    const alignmentInfo = await getAlignmentData( targetPerf, sourcePerf, verseRef );

    //call the webview to display the alignments.
    if( !alignmentInfo ) return;
    const modifiedAlignments : TSourceTargetAlignment[] | undefined = await showWordAlignWebview( context, alignmentInfo );
    if( !modifiedAlignments ) return;

    //get the perf from the active document again in case it changed while the webview was open.
    targetPerf = await getPerfFromActiveNotebook( notebookDocument );
    if( !targetPerf ) return;

    //take the alignments returned by the webview and update the perf.
    //find the chapter and verse from the reference.
    const [book, chapterVerseRef] = verseRef.split(" ");
    const [chapterStr, verseStr] = chapterVerseRef.split(":");
    if( !chapterStr || !verseStr ) return;
    const chapter = parseInt( chapterStr );
    const verse = parseInt( verseStr );

    replaceAlignmentsInPerfInPlace( targetPerf, chapter, verse, modifiedAlignments );

    //modify the document with the new perf.
}