"use babel";

const {BazelBuildProvider} = require("./BazelBuildProvider.js");

export const provideBuilder = () => BazelBuildProvider;
