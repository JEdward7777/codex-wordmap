# _codex-wordmap_

## Description
_codex-wordmap_ is a tool for mapping translated words of the Bible to the source Hebrew and Greek words. This is a Visual Studio Code plugin designed to operate alongside the [codex-editor](https://github.com/genesis-ai-dev/codex-editor) plugin.

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

### Debugging in Visual Studio Code

1. Open this project in Visual Studio Code.
2. Press `F5` to start debugging. This will launch an instance of Visual Studio Code with the extension loaded.
3. In the new instance of Visual Studio Code that opens, you can open or create a Codex project and use the extension for debugging purposes.

### Side Loading the .vsix File

1. After creating the `.vsix` file (as described above), open Visual Studio Code.
2. Go to the Extensions view by clicking the Extensions icon in the Activity Bar on the side of the window or by pressing `Ctrl+Shift+X`.
3. Click the three horizontal dots in the top right corner of the Extensions view.
4. Select "Install from VSIX..." from the dropdown menu.
5. Navigate to the location of the `.vsix` file you created and select it.
6. The extension will be installed and ready to use.

## Running a WordMap Alignment

1. Open a Codex project using the codex-editor plugin. Within the Codex project, open a Codex notebook.
2. **Associate the Codex file with a source USFM file:**
   - Press `Ctrl+Shift+P` and type "Connect Source USFM".
   - Select the USFM file for the specific book. This file might have been downloaded separately or might be in the resources folder downloaded by the Codex system.
   - Verify the connected USFM file using the command "View Connected Source USFM".

3. Place the cursor within the verse you wish to run wordmap on.
4. Click the wordmap wordlens which appears above the verse.
5. Modify the alignment as desired.
6. Select `Accept` to close the wordmap tab or `Cancel` to discard alignment changes.

## Importing and Exporting USFM Files

### Importing a USFM File
1. With a Codex project opened in Visual Studio Code, press `Ctrl+Shift+P` and type "Import USFM".
2. **Note:** The USFM files must be in the ORG versification format. If they are not, the AI tools will not be coherent as verse references will be mismatched.
3. Select the USFM file to import.
4. The related Codex file will appear under `files/target` in the current Codex project.

### Exporting a USFM File
1. Open the Codex file within the Codex project that you want to export.
2. Press `Ctrl+Shift+P` and type "Export USFM".
3. Identify where you want the exported USFM saved and press enter.
4. The USFM file will be exported to the specified location.

## Training Alignment Suggestions

### Alignment Training Settings
_codex-wordmap_ includes the following configurable settings related to alignment training:

1. **codex-wordmap.alignmentTraining.enabled**
   - This setting enables or disables the background training of the alignment suggestion model. If enabled, every time the Codex notebook is saved, the model will retrain in a background thread. This model is used in the wordmap webview to provide alignment suggestions.

2. **codex-wordmap.alignmentTraining.bookGroups**
   - This is a list of book Codex files that should be grouped together when training the alignment AI. Due to the different languages, Old Testament (OT) and New Testament (NT) should be separate groups. Each Codex file should be on its own line, and separate groups should be separated with an empty line. Any file that doesn't match a group will be assumed to be in its own group.  The path is relative to the files/target project folder and the .codex extension is optional.  The AI model can be overwhelmed by too many books grouped together, so it is best to only group smaller books.

### Example bookGroups Configuration
```
# Group for Old Testament
Exodus
Leviticus

# Group for New Testament
TITUS
GALATIANS
```

### Activating User Settings
To modify the alignment training settings for _codex-wordmap_:

1. Open Visual Studio Code and press `Ctrl+Shift+P` to open the Command Palette.
2. Type "Preferences: Open Settings (UI)" to access the settings editor with a user-friendly interface.
3. In the settings, search for `codex-wordmap` to find and modify the relevant settings like `alignmentTraining.enabled` and `alignmentTraining.bookGroups`.
4. Adjust the settings as needed, and ensure your configuration reflects the desired setup for alignment training.

## Usage

To familiarize yourself with the project, please refer to the following [YouTube video](https://youtu.be/a50lTK3R8po) tutorial. Additionally, you may find the following [video](https://youtu.be/Pr1H999OXNw) demonstrating the effective utilization of our AI-powered alignment suggestion feature helpful.

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for more details.