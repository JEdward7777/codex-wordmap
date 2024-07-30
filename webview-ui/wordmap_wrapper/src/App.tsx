import { useEffect, useState } from 'react'
import AlignmentDialogWrapper, { VersionInfo } from './AlignmentDialogWrapper'
import './App.css'
import React from 'react';
import { CodexWordmapMessage, TSourceTargetAlignment } from '../../../src/usfmStuff/utils';

interface VsCodeStub{
  postMessage: (message: CodexWordmapMessage) => void
}

interface AppState{
  alignmentReference: string,
}
function App() {

  const vscodeRef = React.useRef<VsCodeStub | null>(null);

  const [appState, setAppState] = useState<AppState>({
    alignmentReference: ""
  })

  
  //see if the function acquireVsCodeApi exists.
  //Ignore if acquireVsCodeApi does not exist.
  // @ts-expect-error acquireVsCodeApi exists in vscode.
  if (typeof acquireVsCodeApi === 'function' && vscodeRef.current === null ) {
    // @ts-expect-error acquireVsCodeApi exists in vscode.
    vscodeRef.current = acquireVsCodeApi();
  }

  const _requestIdRef = React.useRef(1);
  const _callbacksRef = React.useRef<Map<number, (response: CodexWordmapMessage) => void>>(new Map());

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const postMessageWithResponse = (message: CodexWordmapMessage): Promise<CodexWordmapMessage> =>  {
    const requestId = _requestIdRef.current;
    _requestIdRef.current += 1;
    return new Promise<CodexWordmapMessage>((resolve,error) => {
      _callbacksRef.current.set(requestId, (response: CodexWordmapMessage) => {
        if( response.error ){
          error( response.error );
        }else{
          resolve( response );
        }
      });
      vscodeRef.current?.postMessage({ ...message, requestId });
    });
  }

  const latestAlignmentsRef = React.useRef< TSourceTargetAlignment[] | undefined>(undefined);

  const setAlignmentData = async ( newAlignments : TSourceTargetAlignment[], reference: string ) : Promise<VersionInfo> => {

    latestAlignmentsRef.current = newAlignments;
    
    return { strippedUsfmVersion: 0, alignmentDataVersion: 0, reference };
  }

  const getAlignmentData = async ( reference: string ): Promise<any|undefined> => {
    const getAlignmentDataMessage : CodexWordmapMessage = {
      command: "getAlignmentData",
      content: reference,
    }
    return (await postMessageWithResponse( getAlignmentDataMessage )).content;
  }

  //sign up for messages
  useEffect(() => {
    const messageEventListener = (e: {data: CodexWordmapMessage}) => {
      if( e.data.command === 'alignReference' ){
        console.log( "performing alignment " + e.data.content );
        setAppState( { ...appState, alignmentReference: e.data.content ?? '' } );
      }else if( e.data.command === 'response' ){
        if( e.data.requestId ){
          const callback = _callbacksRef.current.get(e.data.requestId);
          if( callback ){
            callback(e.data);
            _callbacksRef.current.delete(e.data.requestId);
          }
        }
      }
    };
    window.addEventListener('message', messageEventListener);

    return () => window.removeEventListener('message', messageEventListener);
  }, [appState]);

  useEffect(() => {
    if ( vscodeRef.current ) {
      const readyMessage : CodexWordmapMessage = { command: 'ready' };
      vscodeRef.current?.postMessage( readyMessage );
    }
  }, []); // Empty dependency array ensures this runs once after the component mounts


  const handleCancel = () => {
    const cancelMessage : CodexWordmapMessage = { command: 'close' };
    vscodeRef.current?.postMessage( cancelMessage );
  }

  const handleAccept = () => {
    if( latestAlignmentsRef.current !== undefined ){
      const acceptMessage : CodexWordmapMessage = { command: 'return', content: latestAlignmentsRef.current };
      vscodeRef.current?.postMessage( acceptMessage );
    }else{
      handleCancel();
    }
  }

  return (
    <>
      <AlignmentDialogWrapper 
        reference={appState.alignmentReference} 
        setAlignmentData={setAlignmentData}
        getAlignmentData={getAlignmentData}
        strippedUsfmVersion={0}
        alignmentDataVersion={0}
        makeAlignmentSuggestions={undefined}
      />
      <div>
        <button onClick={handleCancel}>CANCEL</button>
        <button onClick={handleAccept}>ACCEPT</button>
      </div>
    </>
  )
}

export default App
