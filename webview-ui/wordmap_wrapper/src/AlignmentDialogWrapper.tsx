import React, { useEffect } from 'react';
//@ts-expect-error This library doesn't have types.
import { SuggestingWordAligner } from 'suggesting-word-aligner-rcl';

import { PRIMARY_WORD, SECONDARY_WORD, TAlignmentSuggestion, TSourceTargetAlignment, 
    TWord, wordMapAlignmentToTSourceTargetAlignment, wordmapTokenToTWord, 
    tAlignmentSuggestionToWordmapSuggestion, TWordAlignerAlignmentResult, 
    TAlignmentPackage} from '../../../src/usfmStuff/utils';

//import css
import './AlignmentDialogWrapper.css';
import { Alignment, Suggestion } from 'wordmap';
import Lexer, { Token } from 'wordmap-lexer';


export interface VersionInfo{
    strippedUsfmVersion: number;
    alignmentDataVersion: number;
    reference: string;
}


interface AlignmentDialogWrapperProps {
    reference: string;
    strippedUsfmVersion: number;
    alignmentDataVersion: number;
    setAlignmentData: (alignmentData: TSourceTargetAlignment[], reference: string) => Promise<VersionInfo>;
    getAlignmentData: (reference: string) => Promise<TAlignmentPackage>;
    makeAlignmentSuggestions?:                (args:  {sourceSentence: TWord[], targetSentence: TWord[], maxSuggestions: number, manuallyAligned: TSourceTargetAlignment[]}) => Promise<TAlignmentSuggestion[]>;
}


// interface SourceMapI{
//     [key: string]: string
// }

interface AlignmentDialogWrapperState {
    alignmentData?: TAlignmentPackage | undefined;
    strippedUsfmVersion?: number | undefined;
    alignmentDataVersion?: number | undefined;
}   

const AlignmentDialogWrapper: React.FC<AlignmentDialogWrapperProps> = ({
    reference,
    strippedUsfmVersion,
    alignmentDataVersion,
    setAlignmentData,
    getAlignmentData,
    makeAlignmentSuggestions,
}) => {

    //This contains the alignment data for the dialog.  Changing
    //This feeds the dialog.  The dialog is keyed off of the reference
    //and version numbers so that if these are changed in state the dialog
    //reloads.
    const [state, setState] = React.useState<AlignmentDialogWrapperState>({});

    //The ref version of the versions, makes it so that we can keep track of
    //of the versions in a way that doesn't update the component so that we can
    //skip updates that we know about already.
    
    //The version number in this can be higher then the version number in state
    //because it gets set by the callback.  But we don't need to update the data
    //in the state with fresh data because the aligner dialog is just happy with the data
    //it has and we don't want to reset it.  This also prevents when there are more then
    //one event flushing through asynchronously that the aligner dialog doesn't get whiplash.
    const versionRefs = React.useRef<VersionInfo>({strippedUsfmVersion: -1, alignmentDataVersion: -1, reference: ""});


    async function figureAlignmentData( strippedUsfmVersion: number, alignmentDataVersion: number, reference: string ) {
        const alignmentData = await getAlignmentData(reference);
        console.log( "webview-ui: alignmentData: " + alignmentData );
        setState({alignmentData,
            strippedUsfmVersion,
            alignmentDataVersion,
        });

        versionRefs.current.strippedUsfmVersion = Math.max( strippedUsfmVersion, versionRefs.current.strippedUsfmVersion );
        versionRefs.current.alignmentDataVersion = Math.max( alignmentDataVersion, versionRefs.current.alignmentDataVersion );
        versionRefs.current.reference = reference;
    }
    useEffect(() => {
        //Ignore updates that we already know about.
        if( strippedUsfmVersion > (versionRefs.current.strippedUsfmVersion ?? -1) || 
            alignmentDataVersion > (versionRefs.current.alignmentDataVersion ?? -1) ||
            reference !== versionRefs.current.reference){
            figureAlignmentData( strippedUsfmVersion, alignmentDataVersion, reference );
        }
    },[reference,strippedUsfmVersion,alignmentDataVersion]);

    const height = 500;

    const translate = (text: string) => {
        if( text === "" ){
            return "";
        }
        return text;
    }

    const showPopover = () =>{
        return false;
    }

    const alignmentInProcessRef = React.useRef(false);
    const stashedAlignmentDataToProcess = React.useRef<TWordAlignerAlignmentResult | undefined>();

    const onAlignmentChangeWrapped = async (alignmentData: TWordAlignerAlignmentResult) => {

        //if the alignment is currently in process, stash the alignment data
        //otherwise process.
        if( !alignmentInProcessRef.current ){
            //mark that we are in process
            alignmentInProcessRef.current = true;

            //init with our own alignment data
            let currentAlignmentData : TWordAlignerAlignmentResult | undefined = alignmentData;
            //and keep looping while we pick up new alignments
            while( currentAlignmentData !== undefined ){

                console.log( "webview-ui: AlignmentData before sleep" ); 
                //sleep to allow the foreground machinery priority.
                await new Promise(r => setTimeout(r, 2000));
                console.log( "webview-ui: AlignmentData after sleep"  ); 
        
                const newVersionRefs : VersionInfo = await setAlignmentData(currentAlignmentData.verseAlignments, reference);
                //The max might be superfluous but it's good to be safe.
                versionRefs.current.alignmentDataVersion = Math.max( versionRefs.current.alignmentDataVersion, newVersionRefs.alignmentDataVersion );
                versionRefs.current.strippedUsfmVersion = Math.max( versionRefs.current.strippedUsfmVersion, newVersionRefs.strippedUsfmVersion );

                //grab new alignment data which have been stashed if they exist.
                currentAlignmentData = stashedAlignmentDataToProcess.current;
                stashedAlignmentDataToProcess.current = undefined;

                if( currentAlignmentData !== undefined ){
                    console.log( "webview-ui: AlignmentData picked up stashed alignment" );
                }
            }

            console.log( "webview-ui: AlignmentData done processing" );

            //mark that we are done.
            alignmentInProcessRef.current = false;
        }else{
            //stash the alignment data if we are in process
            //overwriting any existing alignment already stashed.
            console.log( "webview-ui: AlignmentData Stashing alignment data" );
            stashedAlignmentDataToProcess.current = alignmentData;
        }

    }

    const onAlignmentChange = (alignmentData: TWordAlignerAlignmentResult) => {
        //We want this function to return quickly, so I wrapped the contents and am going to
        //handle the responses with callbacks instead.
        onAlignmentChangeWrapped(alignmentData).catch( (error) => { 
            console.log( `webview-ui: Error in onAlignmentChange: ${error}` ); 
        } );

    }

    console.log( "webview-ui: About to render Alignment dialog wrapper" );


//  /**
//  * @callback AsyncSuggesterCB Takes The source and target translation as well as manual alignments and returns a list of suggestions
//  * @param {string|array[Token]} source - source translation 
//  * @param {string|array[Token]} target - target translation
//  * @param {number} maxSuggestions - max number of suggestions
//  * @param {array[Alignment]} manualAlignments - array manual alignments
//  * @return {Promise<array[Suggestion]>} list of suggestions
//  */

    const asyncSuggester = async ( source: string | Token[], target: string | Token[], maxSuggestions: number, manualAlignments: Alignment[]) : Promise<Suggestion[]> => {

        console.log( "webview-ui: Running asyncSuggester" );

        if( !makeAlignmentSuggestions ) {
            return [];
        }

        let sourceTokens = [];
        let targetTokens = [];

        if (typeof source === "string") {
            sourceTokens = Lexer.tokenize(source);
        } else {
            sourceTokens = source;
        }

        if (typeof target === "string") {
            targetTokens = Lexer.tokenize(target);
        } else {
            targetTokens = target;
        }

        //makeAlignmentSuggestions?: (args:  {sourceSentence: TWord[], targetSentence: TWord[], maxSuggestions: number, manuallyAligned: TSourceTargetAlignment[]}) => Promise<TAlignmentSuggestion[]>;

        //First need to convert sourceTokens into TWords.
        const sourceSentence = sourceTokens.map((token: Token) => wordmapTokenToTWord( token, PRIMARY_WORD   ));
        const targetSentence = targetTokens.map((token: Token) => wordmapTokenToTWord( token, SECONDARY_WORD ));

        const manuallyAligned = manualAlignments.map((alignment: Alignment) => wordMapAlignmentToTSourceTargetAlignment(alignment));

        const suggestions = await makeAlignmentSuggestions({ sourceSentence, targetSentence, maxSuggestions, manuallyAligned });
        
        return suggestions.map( tAlignmentSuggestionToWordmapSuggestion )
    }

    return (
        <div id="AlignmentDialogWrapper">
            <p>Alignment dialog wrapper {reference}</p>
            {Object.keys(state?.alignmentData || {}).length === 0 ? (
                // Show loading message if alignments are an empty dictionary
                <p>Loading...</p>
            ) : (
                // Render the SuggestingWordAligner component if alignments are not empty
                <SuggestingWordAligner
                    key={"" + state?.alignmentData?.reference + "," + state?.strippedUsfmVersion + "," + state?.alignmentDataVersion}
                    style={{ maxHeight: `${height}px`, overflowY: 'auto' }}
                    verseAlignments={state?.alignmentData?.alignments || null}
                    targetWords={state?.alignmentData?.wordBank || null}
                    translate={translate}
                    contextId={{ reference: reference }}
                    targetLanguage={"xxx"}
                    targetLanguageFont={''}
                    sourceLanguage={"yyy"}
                    showPopover={showPopover}
                    lexicons={{}}
                    loadLexiconEntry={(_arg:any) => { return {} }}
                    onChange={onAlignmentChange}
                    asyncSuggester={asyncSuggester}
                />
            )}
        </div>
    );
}


export default AlignmentDialogWrapper