import * as vscode from 'vscode';
import { CodexWordmapMessage, TAlignmentPackage, TAlignmentSuggestion, TSourceTargetAlignment, TWord, tSourceTargetAlignmentToWordmapAlignment, tWordToWordmapToken, wordmapSuggestionToTAlignmentSuggestion } from './usfmStuff/utils';
import { AbstractWordMapWrapper } from 'wordmapbooster/dist/boostwordmap_tools';
import { bookGroupToModelName, filenameToBookGroup, loadAlignmentModel } from './usfmStuff/utilsWithFs';
import * as fs from 'fs';
import { updateTokenLocations } from 'wordmapbooster/dist/wordmap_tools';

export function showWordAlignWebview( context: vscode.ExtensionContext, alignmentInfo: TAlignmentPackage, document_uri: vscode.Uri ) : Promise<TSourceTargetAlignment[] | undefined> {

    const wordAlignWebview = new WordAlignWebview( context, alignmentInfo, document_uri );

    return wordAlignWebview.show();
};


class WordAlignWebview{
    //The returnResolver is what gets called when the webview is closed or the alignment result is returned.
    private returnResolver : ((value: TSourceTargetAlignment[] | undefined) => void) | undefined = undefined;
    private returnCalled : boolean = false;

	private _disposables: vscode.Disposable[] = [];
    private _panel?: vscode.WebviewPanel = undefined;

    constructor( private _context: vscode.ExtensionContext, private alignmentInfo: TAlignmentPackage, private document_uri: vscode.Uri ) {} //private keyword declare and assign properties automatically

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
            (message : CodexWordmapMessage) => {
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
                    case 'ready':
                        //The react component is ready, give it the reference.
                        const setReferenceMessage : CodexWordmapMessage = {
                            command: "alignReference",
                            content: this.alignmentInfo.reference
                        };
                        this._panel?.webview.postMessage(setReferenceMessage);
                        break;
                    case 'getAlignmentData':
                        const getAlignmentResponseMessage : CodexWordmapMessage = {
                            command: "response", 
                            content: this.alignmentInfo,
                            requestId: message.requestId
                        };
                        this._panel?.webview.postMessage(getAlignmentResponseMessage);
                        break;

                    case 'makeAlignmentSuggestions':
                        this.makeAlignmentSuggestions( { documentUri: this.document_uri, ...message.content! }  ).then( result => {
                            const response : CodexWordmapMessage = {
                                command: "response",
                                requestId: message.requestId,
                                content: result,
                            };
                            this._panel?.webview.postMessage(response);
                        }).catch( error => {
                            const response : CodexWordmapMessage = {
                                command: "response",
                                requestId: message.requestId,
                                error,
                            };
                            this._panel?.webview.postMessage(response);
                        });
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

        const reactIndexJsUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this._context.extensionUri, 'webview-ui', 'wordmap_wrapper', 'build', 'assets', 'index.js'));
        
        const reactIndexCssUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this._context.extensionUri, 'webview-ui', 'wordmap_wrapper', 'build', 'assets', 'index.css'));

        return `<!doctype html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Word Align Webview</title>
            <script type="module" crossorigin src="${reactIndexJsUri}"></script>
            <link rel="stylesheet" crossorigin href="${reactIndexCssUri}">
          </head>
          <body>
            <div id="root"></div>
          </body>
        </html>
        `;
    }

    
    private static loaded_alignment_models: { [model_name: string]: { 
        model: any, 
        file_modification_time: number } 
    } = {};

    private static loaded_alignment_model_unload_timers: { [model_name: string]: NodeJS.Timeout } = {};

    async loadAlignmentModelForDocument(documentUri: vscode.Uri) : Promise<AbstractWordMapWrapper | undefined>{
        const getConfigurationFunction = async ( section: string ) : Promise<string> => {
            return vscode.workspace?.getConfiguration("codex-wordmap").get( section ) ?? "";
        };
        const getWorkSpaceFoldersFunction = async () => vscode.workspace.workspaceFolders;


        const getCurrentFile = async () => {
            return [documentUri.fsPath];
        };

        //first figure out what the filename is for this document
        const bookGroup = await filenameToBookGroup( documentUri.fsPath,  getConfigurationFunction,
            getWorkSpaceFoldersFunction, getCurrentFile );
        if( bookGroup === undefined ) return undefined;
        
        const modelPath = bookGroupToModelName( bookGroup );
        if( modelPath === undefined ) return undefined;

        //see if model_name is loaded in load_alignment_models.

        if( !(modelPath in WordAlignWebview.loaded_alignment_models)){
            const result = await loadAlignmentModel( modelPath );
            if ( result === undefined ) return undefined;
            if ( result.model === undefined ) return undefined;
            WordAlignWebview.loaded_alignment_models[modelPath] = result;
        }

        const {model, file_modification_time} : {model: AbstractWordMapWrapper, file_modification_time: number} = WordAlignWebview.loaded_alignment_models[modelPath];


        //make it so that if a model is not used for 5 minutes it is unloaded
        const modelTimeoutMs = 1000 * 60 * 5;
        //reset the timer and set it again.
        if( modelPath in WordAlignWebview.loaded_alignment_model_unload_timers ){
            clearTimeout( WordAlignWebview.loaded_alignment_model_unload_timers[modelPath] );
        }
        WordAlignWebview.loaded_alignment_model_unload_timers[modelPath] = setTimeout( () => {
            delete WordAlignWebview.loaded_alignment_models[modelPath];
            delete WordAlignWebview.loaded_alignment_model_unload_timers[modelPath];
        }, modelTimeoutMs );


        //now return a promise that returns the model and after the model has
        //been returns checks if the modification time of the file is actually later.
        return new Promise<AbstractWordMapWrapper>( async (resolve, reject) => {
            //first resolve the result and then check if we need to reload
            resolve( model );

            const stat = await fs.promises.stat( modelPath );
            const current_modification_time = stat.mtimeMs;
            if( current_modification_time > file_modification_time ){
                WordAlignWebview.loaded_alignment_models[modelPath] = await loadAlignmentModel( modelPath );
            }            
        } );
    }

    async makeAlignmentSuggestions(
        {documentUri,             sourceSentence,          targetSentence,          maxSuggestions,         manuallyAligned} : 
        {documentUri: vscode.Uri, sourceSentence: TWord[], targetSentence: TWord[], maxSuggestions: number, manuallyAligned: TSourceTargetAlignment[]}) : Promise<TAlignmentSuggestion[]>{

        const model = await this.loadAlignmentModelForDocument( documentUri );
        if( model === undefined ) return [];
        
        //convert all the things over from TWord stuffs to wordmap stuffs.
        const sourceSentenceWordMap = sourceSentence.map( tWordToWordmapToken );
        const targetSentenceWordMap = targetSentence.map( tWordToWordmapToken );
        updateTokenLocations( sourceSentenceWordMap );
        updateTokenLocations( targetSentenceWordMap );
        const manuallyAlignedWordMap = manuallyAligned.map( tSourceTargetAlignmentToWordmapAlignment );

        console.log( "making alignment suggestions" );
        
        const suggestions = model.predict( sourceSentenceWordMap, targetSentenceWordMap, maxSuggestions, manuallyAlignedWordMap );
        console.log( "made alignment suggestions" );
        console.log( suggestions );

        const convertedSuggestions = suggestions.map( wordmapSuggestionToTAlignmentSuggestion );
        return convertedSuggestions;
    }
};