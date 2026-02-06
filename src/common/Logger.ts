/*
 * Copyright 2026 Pavan Kulkarni
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as vscode from 'vscode';

export class Logger {
    private static _outputChannel: vscode.OutputChannel;

    public static get channel(): vscode.OutputChannel {
        if (!this._outputChannel) {
            this._outputChannel = vscode.window.createOutputChannel("CodeBlocks");
        }
        return this._outputChannel;
    }

    private static _log(level: string, message: string) {
        const time = new Date().toLocaleTimeString();
        this.channel.appendLine(`[${level}] [${time}] ${message}`);
    }

    public static info(message: string) {
        this._log('INFO', message);
    }

    public static warn(message: string) {
        this._log('WARN', message);
    }

    public static error(message: string, error?: any) {
        this._log('ERROR', message);
        if (error) {
            this.channel.appendLine(JSON.stringify(error, null, 2));
            if (error.stack) {
                this.channel.appendLine(error.stack);
            }
        }
    }

    public static show() {
        this.channel.show(true);
    }
}
