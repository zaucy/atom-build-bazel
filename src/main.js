"use babel";

const {BazelBuildProvider} = require("./BazelBuildProvider.js");

console.log("atom-build-bazel");


export const provideBuilder = () => BazelBuildProvider;
