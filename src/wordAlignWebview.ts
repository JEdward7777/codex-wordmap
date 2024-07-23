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
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'webview-ui','wordmap_wrapper','build')]
            }
        );
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
   }

    private getHtmlForWebview( webview: vscode.Webview ) {

        const viteSvgUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this._context.extensionUri, 'webview-ui', 'wordmap_wrapper', 'build', 'vite.svg'));

        const reactIndexJsUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this._context.extensionUri, 'webview-ui', 'wordmap_wrapper', 'build', 'assets', 'index.js'));
        
        const reactIndexCssUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this._context.extensionUri, 'webview-ui', 'wordmap_wrapper', 'build', 'assets', 'index.css'));

        return `<!doctype html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <link rel="icon" type="image/svg+xml" href="${viteSvgUri}" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Vite + React</title>
            <script type="module" crossorigin src="${reactIndexJsUri}"></script>
            <link rel="stylesheet" crossorigin href="${reactIndexCssUri}">
          </head>
          <body>
            <div id="root"></div>
          </body>
        </html>
        `;
    }
};