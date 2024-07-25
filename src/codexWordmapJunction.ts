import * as vscode from "vscode";
import { getPerfFromActiveNotebook, readUsfmData } from "./usfmStuff/importUsfm";

function getSourceMapping( notebookDocument: vscode.NotebookDocument ) : string | undefined {
    for( const cell of notebookDocument.getCells() ) {
        if (cell.kind === vscode.NotebookCellKind.Markup) {
            if( cell?.metadata?.wordmapSettings?.sourceMapping ) {
                return cell?.metadata?.wordmapSettings?.sourceMapping;
            }
        }
    }
    return undefined;
}

export async function doCodexWordMapping( context: vscode.ExtensionContext, notebookDocument: vscode.NotebookDocument, line: string, verseRef: string ) {

    //verify that the current document has a source file specified.
    const sourceMapping : string | undefined = getSourceMapping( notebookDocument );
    if( !sourceMapping ) {
        //pop up an information message
        vscode.window.showInformationMessage( "Please connect a source file using the 'Connect Source File' command." );
        return;
    }

    //Get the perf from the active notebook.
    const perf = await getPerfFromActiveNotebook( notebookDocument );

    //get the perf for the source document.
    const sourcePerf = Object.values(readUsfmData( [vscode.Uri.parse( sourceMapping )] ))[0];


    //extract the alignments supplemented by the source document.

    //call the webview to display the alignments.

    //get the perf from the active document again in case it changed while the webview was open.

    //take the alignments returned by the webview and update the perf.

    //modify the document with the new perf.
}