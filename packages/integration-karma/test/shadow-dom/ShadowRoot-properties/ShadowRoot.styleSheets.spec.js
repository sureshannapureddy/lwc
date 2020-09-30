import { createElement } from 'lwc';

import Test from 'x/test';

describe('ShadowRoot.styleSheets', () => {
    it('should return the shadow tree stylesheets element', () => {
        const elm = createElement('x-test', { is: Test });
        document.body.appendChild(elm);

        const sheets = elm.styleSheets;
        expect(sheets).toEqual(['test']);
    });
});
