// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { registerCodeLenses } from './wordLensProvider';
import { registerUsfmImporter } from './usfmStuff/importUsfm';
import { registerCodexOnSaveHook } from './codexWordmapJunction';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	//register the codelens which shows WordMap.
	registerCodeLenses(context);

	registerUsfmImporter(context);

	registerCodexOnSaveHook(context);
}

// This method is called when your extension is deactivated
export function deactivate() {}
