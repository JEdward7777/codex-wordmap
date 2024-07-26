import { useState } from 'react'
import AlignmentDialogWrapper, { VersionInfo } from './AlignmentDialogWrapper'
import './App.css'


interface AppState{
  alignmentReference: string,
}
function App() {


  const [appState, setAppState] = useState<AppState>({
    alignmentReference: ""
  })


  const setAlignmentData = async ( newAlignments : any, reference: string ) : Promise<VersionInfo> => {

    //STUB
    
    return { strippedUsfmVersion: 0, alignmentDataVersion: 0, reference };
  }

  const getAlignmentData = async ( reference: string ): Promise<any|undefined> => {
    //return (await postMessageWithResponse( { command: 'getAlignmentData', content: getDocumentData(), commandArg: reference } )).response;

    //STUB
    return undefined;
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
    </>
  )
}

export default App
