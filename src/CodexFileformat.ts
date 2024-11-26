import * as vscode from "vscode";

interface Timestamps {
    startTime?: number;
    endTime?: number;
}

export enum EditType {
    USER_EDIT = "user-edit",
    LLM_EDIT = "llm-edit",
    LLM_GENERATION = "llm-generation",
}

export enum CodexCellTypes {
    TEXT = "text",
    PARATEXT = "paratext",
}


type CodexData = Timestamps & {
    [key: string]: any;
};

type EditHistory = {
    cellValue: string;
    timestamp: number;
    type: EditType;
};

export interface NavigationCell {
    cellId: string;
    children: NavigationCell[];
    label: string;
}


type CustomCellMetaData = {
    id: string;
    type: CodexCellTypes;
    data?: CodexData;
    edits?: EditHistory[];
    attachments?: {
        [key: string]: {
            url: string;
            type: string;
        };
    };
};


type CustomNotebookMetadata = {
    id: string;
    textDirection?: "ltr" | "rtl";
    perf?: any;
    wordmapSettings?: {
        sourceMapping?: string;
    }
    attachments?: {
        [key: string]: {
            url: string;
            type: string;
        };
    };
    originalName: string;
    sourceFsPath: string | undefined;
    codexFsPath: string | undefined;
    navigation: NavigationCell[];
    videoUrl?: string;
    sourceCreatedAt: string;
    codexLastModified?: string;
    gitStatus:
        | "uninitialized"
        | "modified"
        | "added"
        | "deleted"
        | "renamed"
        | "conflict"
        | "untracked"
        | "committed"; // FIXME: we should probably programmatically do things like track .codex .source and .dictionary files
    corpusMarker: string;
};

type CustomNotebookCellData = vscode.NotebookCellData & {
    metadata: CustomCellMetaData;
};

export type CodexNotebookAsJSONData = {
    cells: CustomNotebookCellData[];
    metadata: CustomNotebookMetadata;
};