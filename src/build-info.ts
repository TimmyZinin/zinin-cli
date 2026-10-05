import metadata from "../package.json";
declare const ZININ_BUILD_GIT:string;
declare const ZININ_BUILD_DATE:string;
declare const ZININ_BUILD_DIRTY:boolean;
/** Replaced by build-time defines; source runs honestly report unbuilt. */
export const BUILD_INFO=Object.freeze({version:metadata.version,git:typeof ZININ_BUILD_GIT==="string"?ZININ_BUILD_GIT:"unbuilt",builtAt:typeof ZININ_BUILD_DATE==="string"?ZININ_BUILD_DATE:null,dirty:typeof ZININ_BUILD_DIRTY==="boolean"?ZININ_BUILD_DIRTY:null});
export const buildVersion=()=>BUILD_INFO.git==="unbuilt"?`v${BUILD_INFO.version}+unbuilt`:`git-${BUILD_INFO.git}@${BUILD_INFO.builtAt}${BUILD_INFO.dirty?"+dirty":""}`;
