export interface WorkerMessage{
    command: string,
    requestId?: number,
    content?: any,
    error?: any,
}