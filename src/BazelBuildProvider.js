"use babel";

const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
const child_process = require("child_process");
const promisify = require('util.promisify');
const chokidar = require("chokidar");

const RunTargetsView = require("./RunTargetsView.js");

const execFile = promisify(child_process.execFile);

let bazelsRunning = {};

class BazelBuildProvider extends EventEmitter {
	constructor(cwd) {
		super();
		this.cwd = cwd;
		// @TODO: Make bazel executable option
		this.bazelExec = `bazel`;
		this.bazelTargets = [];

		if(!bazelsRunning[this.cwd]) {
			bazelsRunning[this.cwd] = 0;
		}
	}

	_watch() {
		if(this.watcher) {
			return;
		}

		this.watcher = chokidar.watch([
			"./WORKSPACE",
			"./BUILD",
			"./**/BUILD",
		], {
			cwd: this.cwd,
			followSymlinks: false,
			awaitWriteFinish: true,
		});

		this.watcher.on('change', (path) => {
			this._refresh();
		});

		// These get triggered everytime, cannot refresh on add/unlink
		// this.watcher.on('add', () => this._refresh());
		// this.watcher.on('unlink', () => this._refresh());
	}

	_refresh() {
		clearTimeout(this._refreshTimeout);

		if(bazelsRunning[this.cwd] > 0) {
			return;
		}

		this._refreshTimeout = setTimeout(() => {
			this.emit("refresh");
		}, 10);
	}

	async execBazel(...args) {
		let result;
		bazelsRunning[this.cwd] += 1;

		const options = {
			cwd: this.cwd
		};

		result = await execFile(this.bazelExec, args, options).catch((err) => {
			bazelsRunning[this.cwd] -= 1;
			err.bazelArgs = args;
			return Promise.reject(err);
		});

		bazelsRunning[this.cwd] -= 1;

		return result;
	}

	destructor() {
		if(this.watcher) {
			this.watcher.close();
		}
	}

	getNiceName() {
		return "Build Bazel";
	}

	isEligible() {
		const workspaceFilePath = path.resolve(this.cwd, "WORKSPACE");
		let stats = null;

		try {
			stats = fs.statSync(workspaceFilePath);
		} catch(err) {
			if(err.code !== 'ENOENT') {
				throw err;
			}
		}

		return stats && stats.isFile();
	}

	settingsError(err) {

		let shortErrMsg = "";
		let fullErrMsg = "";
		if(err && err.message) {
			shortErrMsg = err.message;
			fullErrMsg = err.message;

			const ERR_MSG_PREFIXES = [
				"Command failed:",
				"bazel " + (err.bazelArgs||[]).join(" "),
				"ERROR:",
				this.cwd,
				this.cwd.replace(/\\/g, "/"),
				"/",
				"\\"
			];

			for(let errMsgPrefix of ERR_MSG_PREFIXES) {
				if(shortErrMsg.toLowerCase().startsWith(errMsgPrefix.toLowerCase())) {
					shortErrMsg = shortErrMsg.substr(errMsgPrefix.length).trim();
				}
			}

			if(shortErrMsg.length > 64) {
				shortErrMsg = shortErrMsg.substr(0, 64) + " (...)";
			}

		} else {
			shortErrMsg = " unknown";
			console.error("build-bazel bazel unknown error:", err);
		}

		let echoFullErrMsg = fullErrMsg.replace(/\"/g, "\\\"");

		echoFullErrMsg = echoFullErrMsg.split("\n").map(msg => {
			return msg ? `echo ${msg} && ` : '';
		});

		this.bazelTargets = [{
			exec: `${echoFullErrMsg} exit 1`,
			name: "<BAZEL ERROR> " + shortErrMsg,
			cwd: this.cwd,
		}];

		return this.bazelTargets;
	}

	async settings() {

		const execBazel = this.execBazel.bind(this);
		let targetsErr = null;

		const targetsRaw = await this.execBazel(
			'query',
			'--noimplicit_deps',
			'--nohost_deps',
			`kind('rule', deps(//...))`
		).catch(err => {
			targetsErr = err;
			return "";
		});

		this._watch();

		if(targetsErr) {
			return this.settingsError(targetsErr);
		}

		const targetNames = targetsRaw.split("\n");

		this.bazelTargets = [
			{
				exec: this.bazelExec,
				args: ["clean"],
				name: "clean",
				cwd: this.cwd,
			},
			{
				exec: this.bazelExec,
				name: "run",
				preBuild: async function() {
					let runTargetsView = new RunTargetsView();

					let result = await execBazel(
						"query",
						"kind('_binary', deps(//...))"
					);

					let runnableTargetNames = result.split("\n");
					let runnableTargets = [];

					for(let runTargetName of runnableTargetNames) {
						runTargetName = runTargetName.trim();

						if(!runTargetName || !runTargetName.startsWith("//")) {
							continue;
						}

						runnableTargets.push(runTargetName);
					}

					runTargetsView.setItems(runnableTargets);

					try {
						let confirmedTarget = await runTargetsView.awaitItemConfirmed();

						this.args = [
							"run",
							confirmedTarget
						];
					} catch(err) {
						this.exec = "echo";
						this.args = [err];
					}
				}
			},
			{
				exec: this.bazelExec,
				args: ["build", "//...:*"],
				name: "//...:*",
				cwd: this.cwd,
			}
		];

		for(let targetName of targetNames) {
			targetName = targetName.trim();

			if(!targetName || !targetName.startsWith("//")) {
				continue;
			}

			this.bazelTargets.push({
				exec: this.bazelExec,
				args: ["build", targetName],
				name: targetName,
				cwd: this.cwd,
			});
		}

		return this.bazelTargets;
	}
};

exports.BazelBuildProvider = BazelBuildProvider;
