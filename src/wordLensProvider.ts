
import * as vscode from "vscode";
import { extractVerseRefFromLine } from "./utils/verseRefUtils";
import { doCodexWordMapping, getSourceUri, setSourceUri } from "./codexWordmapJunction";

function extractLineFromNotebook(notebookDocument: vscode.NotebookDocument, verseRef: string): {cell: vscode.NotebookCell, line_number: number, line: string}|undefined {
    //spin through the cells in the document and find the line that starts with verseRef.
    //This document is a notebook.
    for( const [cell_index, cell] of notebookDocument.getCells().entries() ) {
        if (cell.kind === vscode.NotebookCellKind.Code) {
            for (const [line_number, line] of cell.document.getText().split("\n").entries()) {
                if (line.startsWith(verseRef)) {
                    return {cell, line_number, line};
                }
            }
        }
    }
    return undefined;
}

function getActiveCodexNotebook(): vscode.NotebookDocument | undefined {
    const notebookDocument = vscode.window.activeNotebookEditor?.notebook;
    if (!notebookDocument) {
        //Pop up an error message
        vscode.window.showErrorMessage("No active notebook.");
        return undefined;
    }

    //Now verify that the current notebook is a codex file.
    const uri = vscode.window.activeTextEditor?.document.uri;
    const activeFileIsACodexFile = uri?.toString().includes(".codex");
    if (!activeFileIsACodexFile) {
        //Pop up an error message
        vscode.window.showErrorMessage("Not a codex file.");
        return undefined;
    }

    return notebookDocument;
}

class WordLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter();
    readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    refresh() {
        this._onDidChangeCodeLenses.fire();
    }

    provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
        const lenses : vscode.CodeLens[] = [];
        const activeEditor = vscode.window.activeTextEditor;
        if ( activeEditor && activeEditor.document === document ){
            const cursorPosition = activeEditor.selection.active;
            const line = document.lineAt(cursorPosition.line);
            const verseRef = extractVerseRefFromLine(line.text);
            let uri = vscode.window.activeTextEditor?.document.uri;
            const activeFileIsACodexFile = uri?.toString().includes(".codex");
            if (verseRef && activeFileIsACodexFile) {
                lenses.push(new vscode.CodeLens(line.range, {
                    title: 'WordMap',
                    command: 'codex-wordmap.wordmap',
                    arguments: [verseRef, document.uri.toString()]
                }));
            }
        }

        return lenses;
    }
}


export const registerCodeLenses = (context: vscode.ExtensionContext) => {
    const wordLensProvider = new WordLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ pattern: '**/*.codex' }, wordLensProvider)
    );
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(() => wordLensProvider.refresh())
    );
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => wordLensProvider.refresh())
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'codex-wordmap.setSourceUri',
            async () => {
                //Get the active notebook
                const activeCodexNotebook = getActiveCodexNotebook();
                if (!activeCodexNotebook) return;
                
                //Now pop up a file open dialog which selects a usfm file.
                const sourceUri = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    openLabel: 'Select USFM Source',
                    title: 'Select USFM Source',
                    defaultUri: vscode.Uri.file(activeCodexNotebook.uri.fsPath),
                    filters: {
                        'USFM': ['usfm','USFM','usf','USF']
                    }
                });
                if (!sourceUri) return;

                //Now set the source uri in the active notebook.
                await setSourceUri( activeCodexNotebook, sourceUri[0].fsPath );
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'codex-wordmap.getSourceUri',
            async () => {
                //Get the active notebook
                const activeCodexNotebook = getActiveCodexNotebook();
                if (!activeCodexNotebook) return;

                //Now get the source uri in the active notebook.
                const sourceUri = getSourceUri( activeCodexNotebook );

                //now report the findings.
                if( sourceUri ){
                    //vscode.window.showInformationMessage( `The source language USFM is set to:\n${sourceUri}`);

                    vscode.window.showInputBox({
                        value: sourceUri,
                        placeHolder: 'The source language USFM is set to:'
                    }).then((newUri) => {
                        if (newUri && newUri !== sourceUri) {
                            // Handle the updated URI
                            setSourceUri(activeCodexNotebook, newUri);
                            vscode.window.showInformationMessage(`The source language USFM has been updated`);
                        }
                    });
                }else{
                    vscode.window.showInformationMessage( `The source language USFM is not set.`);
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'codex-wordmap.wordmap',
            async (verseRef: string, uri: string) => {
                if( !verseRef || !uri ) return;


                //get the document that is open from the uri.  This is a notebook.
                //const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri);
                const uriObj = vscode.Uri.parse( uri );
                const notebookDocument = vscode.workspace.notebookDocuments.find(doc => doc.uri.fsPath === uriObj.fsPath);
                if (notebookDocument) {
                    const foundLine = extractLineFromNotebook(notebookDocument, verseRef);
                    if( foundLine ){
                        await doCodexWordMapping( context, notebookDocument, verseRef );
                    }
                }
            }
        )
    );
};