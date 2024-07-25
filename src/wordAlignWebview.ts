import * as vscode from 'vscode';
import { TSourceTargetAlignment, TWord } from './usfmStuff/utils';

export function showWordAlignWebview( context: vscode.ExtensionContext, alignmentInfo: {wordBank: TWord[], alignments: TSourceTargetAlignment[], reference: string} ) : Promise<TSourceTargetAlignment[] | undefined> {

    const wordAlignWebview = new WordAlignWebview( context, alignmentInfo );

    return wordAlignWebview.show();
};


class WordAlignWebview{
    //The returnResolver is what gets called when the webview is closed or the alignment result is returned.
    private returnResolver : ((value: TSourceTargetAlignment[] | undefined) => void) | undefined = undefined;
    private returnCalled : boolean = false;

	private _disposables: vscode.Disposable[] = [];
    private _panel?: vscode.WebviewPanel = undefined;

    constructor( private _context: vscode.ExtensionContext, private alignmentInfo: {wordBank: TWord[], alignments: TSourceTargetAlignment[], reference: string} ) {} //private keyword declare and assign properties automatically

    public show() : Promise<TSourceTargetAlignment[] | undefined>  {
        this._panel = vscode.window.createWebviewPanel(
            'codexWordMap',
            'Codex WordMap',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'webview-ui','wordmap_wrapper','build')]
            }
        );
        this._panel.webview.html = this.getHtmlForWebview(this._panel.webview);


		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programmatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        //Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'return':
                        if( !this.returnCalled ) {
                            this.returnCalled = true;
                            this.returnResolver?.(message.content);
                        }
                        this.dispose();
                        break;
                    case 'close': 
                        this.dispose();
                        break;
                }
            },
            undefined,
			this._disposables
        );

        return new Promise( (resolve) => {
            this.returnResolver = resolve;
        } );
   }

    public dispose() {
        if( !this.returnCalled ){
            this.returnCalled = true;
            this.returnResolver?.(undefined);
        }

        // Clean up our resources
        this._panel?.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
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