
import * as vscode from "vscode";
import { extractVerseRefFromLine } from "./codexUtils/verseRefUtils";
import { doCodexWordMapping, getActiveCodexNotebookAsJsonData, getSourceUri, getVerseRefFromStateStore, loadCodex, setSourceUri } from "./codexWordmapJunction";
import { CodexNotebookAsJSONData } from "./CodexFileformat";

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

async function getActiveCodexNotebook(): Promise<[CodexNotebookAsJSONData, vscode.Uri]> {
    return await getActiveCodexNotebookAsJsonData();
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

    //Add a statusBarItem as well for when we don't have a wordlens option.
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = '$(map) WordMap';
    statusBarItem.tooltip = 'Trigger WordMap Command';
    statusBarItem.command = 'codex-wordmap.wordmap';
    context.subscriptions.push(statusBarItem);

    // Show status bar item only if the active file is a Codex file
    const updateStatusBarVisibility = () => {
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        const isCodexFile = (tab?.input as any)?.uri?.toString().endsWith(".codex");
        if (isCodexFile) {
             statusBarItem.show();
        } else {
            statusBarItem.hide();
        }
    };

    // Update visibility on editor change or active document change
    //context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBarVisibility));
    //context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(updateStatusBarVisibility));
    context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(updateStatusBarVisibility));


    // Initial visibility update
    updateStatusBarVisibility();



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
                const [activeCodexNotebook, activeNotebookUri] = await getActiveCodexNotebook();
                if (!activeCodexNotebook) return;
                
                //Now pop up a file open dialog which selects a usfm file.
                const sourceUri = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    openLabel: 'Select USFM Source',
                    title: 'Select USFM Source',
                    defaultUri: vscode.Uri.file(activeNotebookUri.fsPath),
                    filters: {
                        'USFM': ['usfm','USFM','usf','USF']
                    }
                });
                if (!sourceUri) return;

                //Now set the source uri in the active notebook.
                await setSourceUri( activeNotebookUri, sourceUri[0].fsPath );
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'codex-wordmap.getSourceUri',
            async () => {
                //Get the active notebook
                const [activeCodexNotebook, activeNotebookUri] = await getActiveCodexNotebook();
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
                            setSourceUri(activeNotebookUri, newUri);
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
            async (_verseRef: string, _uri: string) => {
                //Just ignoring the verseRef and uri arguments.  They were used when this was a wordlens on a document.
                //Now I am just going to pick this information up by what is the active tab and use shared state
                //to find the verseRef.

                //Going to just utilize the file off of the disk, so make sure the tab is a .codex file and also
                //that it isn't dirty.
                const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
                const isCodexFile = (tab?.input as any)?.uri?.toString().endsWith(".codex");
                if (!isCodexFile) return;

                //now check if it is dirty using the tab constant.
                const isDirty = tab?.isDirty;
                //if it is dirty fuss about it.
                if (isDirty) {
                    vscode.window.showInformationMessage( `The file has unsaved changes.  Please save the file first.`);
                    return;
                }

                //I now need to get the verseRef from the state store.
                const verseRef = await getVerseRefFromStateStore();

                if (!verseRef) {
                    vscode.window.showInformationMessage( `No verse currently selected.`);
                    return;
                }


                try{
                    const document_uri = (tab?.input as any)?.uri;
                    const codexDoc = await loadCodex(document_uri);
                    await doCodexWordMapping(context, codexDoc, verseRef, document_uri);
                    vscode.window.showInformationMessage( "Wordmap complete" );
                }catch(e){
                    vscode.window.showInformationMessage( `Wordmap failed.  ${e}` );
                }
                


                // //get the document that is open from the uri.  This is a notebook.
                // //const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri);
                // const uriObj = vscode.Uri.parse( uri );
                // const notebookDocument = vscode.workspace.notebookDocuments.find(doc => doc.uri.fsPath === uriObj.fsPath);
                // if (notebookDocument) {
                //     const foundLine = extractLineFromNotebook(notebookDocument, verseRef);
                //     if( foundLine ){
                //         await doCodexWordMapping( context, notebookDocument, verseRef );
                //     }
                // }
            }
        )
    );
};