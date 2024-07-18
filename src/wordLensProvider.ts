
import * as vscode from "vscode";
import { extractVerseRefFromLine } from "./utils/verseRefUtils";

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

function showLineInWebview( context: vscode.ExtensionContext, line: string ) {
    const webviewPanel = vscode.window.createWebviewPanel(
        'codexWordMap',
        'Codex WordMap',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true
        }
    );
    webviewPanel.webview.html = `
        <html>
            <body>
                <p>${line}</p>
            </body>
        </html>
    `;
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
            'codex-wordmap.wordmap',
            (verseRef: string, uri: string) => {
                //Pop up a dialog showing the reference.
                vscode.window.showInformationMessage(verseRef);

                //get the document that is open from the uri.  This is a notebook.
                //const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri);
                const uriObj = vscode.Uri.parse( uri );
                const notebookDocument = vscode.workspace.notebookDocuments.find(doc => doc.uri.fsPath === uriObj.fsPath);
                if (notebookDocument) {
                    const foundLine = extractLineFromNotebook(notebookDocument, verseRef);
                    if( foundLine ){
                        showLineInWebview( context, foundLine.line );
                    }
                }
            }
        )
    );
};