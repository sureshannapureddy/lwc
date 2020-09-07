/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: MIT
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/MIT
 */
const path = require('path');
const typescript = require('typescript');
const rollupTypescript = require('rollup-plugin-typescript');
const rollupNodeResolve = require('rollup-plugin-node-resolve');
const babel = require('@babel/core');
const babelFeaturesPlugin = require('@lwc/features/src/babel-plugin');

const packageJson = require('../package.json');

const banner = `/* proxy-compat-disable */`;
const footer = `/* version: ${packageJson.version} */`;
const formats = ['es', 'cjs'];

function rollupFeaturesPlugin() {
    return {
        name: 'rollup-plugin-lwc-features',
        transform(source) {
            return babel.transform(source, {
                plugins: [babelFeaturesPlugin],
            }).code;
        },
    };
}

module.exports = {
    input: path.resolve(__dirname, '../src/index.ts'),

    external: Object.keys(packageJson.dependencies || {}),

    output: formats.map((format) => {
        return {
            file: path.resolve(
                __dirname,
                '../dist',
                `synthetic-shadow${format === 'cjs' ? '.cjs' : ''}.js`
            ),
            format,
            banner: banner,
            footer: footer,
        };
    }),

    plugins: [
        rollupNodeResolve(),
        rollupTypescript({
            target: 'es2017',
            typescript,
        }),
        rollupFeaturesPlugin(),
    ],

    onwarn({ code, message }) {
        if (code !== 'CIRCULAR_DEPENDENCY') {
            throw new Error(message);
        }
    },
};
