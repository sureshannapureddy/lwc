/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: MIT
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/MIT
 */

window.BrowserEnv = (function () {
    const innerTextDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    const innerTextGetter = innerTextDescriptor.get;
    const outerTextDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'outerText');
    const outerTextGetter = outerTextDescriptor.get;

    return {
        innerTextGetter,
        outerTextGetter,
    };
})();
