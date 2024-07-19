import * as vscode from 'vscode';

export async function showWebview( context: vscode.ExtensionContext, line: string ) {

    const wordAlignWebview = new WordAlignWebview( context, line );

    await wordAlignWebview.show();
};


class WordAlignWebview{
    constructor( private _context: vscode.ExtensionContext, private line: string ) {
    }

    public async show() {
        const webviewPanel = vscode.window.createWebviewPanel(
            'codexWordMap',
            'Codex WordMap',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
   }

    private getHtmlForWebview( webview: vscode.Webview ) {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Codex WordMap</title>
            </head>
            <body>
                <p>${this.line}</p>
            </body>
            </html>`;
    }
};