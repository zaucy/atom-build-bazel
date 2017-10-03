'use babel';

import {SelectListView} from 'atom-space-pen-views';

export default class TargetsView extends SelectListView {
	constructor() {
		super(...arguments);
		this.show();
		this.resolveMethod = null;
		this.rejectMethod = null;
	}

	viewForItem(item) {
		return `<li>${item}</li>`;
	}

	show() {
		this.panel = atom.workspace.addModalPanel({item: this});
    this.panel.show();
    this.focusFilterEditor();
	}

	hide() {
    this.panel.hide();
  }

	awaitItemConfirmed(item) {
		return new Promise((resolve, reject) => {
			this.resolveMethod = resolve;
			this.rejectMethod = reject;
		});
	}

	confirmed(item) {
		this.hide();
		this.resolveMethod(item);
	}

	cancelled() {
		this.hide();
		this.rejectMethod("User cancelled");
	}
};
