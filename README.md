# _codex-wordmap_

## Description
_codex-wordmap_ is a tool for mapping translated words of the Bible to the source Hebrew and Greek words.  This is a vscode plugin designed to operate along-side the [codex-editor](https://github.com/genesis-ai-dev/codex-editor) plugin.

## Prerequisites
- Node.js (version 18.16.0 or higher)
- npm (version 9.5.1 or higher)
- Visual Studio Code

## Installation

### Cloning the Repository
```sh
git clone https://github.com/JEdward7777/codex-wordmap
cd codex-wordmap
```

### Installing Dependencies
```sh
npm install
cd webview-ui/wordmap_wrapper
npm install
```

### Building the Project
To build the project, run the following command from the main repository directory:
```sh
npm run build
```
This will also compile the sub-repository.

## Compiling the vsix Extension

1. Install the VSCE (Visual Studio Code Extensions) tool globally:
    ```sh
    npm install -g @vscode/vsce
    ```

2. Create the `vsix` file using the following command:
    ```sh
    vsce package
    ```
   The file format for installing an extension outside of the store is `.vsix`. See more information [here](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

## Running the Extension

1. Open this project in Visual Studio Code.

2. Open a Codex project using the codex-editor plugin. Within the Codex project, open a Codex notebook.
3. Associate the Codex file with a source USFM file:
   - Press `Ctrl+Shift+P` and type "Connect Source USFM".
   - Select the USFM file for the specific book. This file might have been downloaded separately or might be in the resources folder downloaded by the Codex system.
   - Verify the connected USFM file using the command "View Connected Source USFM".

5. Place the cursor within the verse you wish to run wordmap on.
6. Click the wordmap wordlens which appears above the verse.
7. Modify the alignment as desired.
8. Select `Accept` to close the wordmap tab or `Cancel` to discard alignment changes.

## Usage

For a video demonstration on how to use the project, visit our [YouTube tutorial](https://youtu.be/jyfAQwSdZts).

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for more details.