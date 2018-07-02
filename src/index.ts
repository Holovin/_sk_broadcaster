import 'source-map-support/register';
import prettyError from 'pretty-error';

import request from 'request-promise-native';

import * as moment from 'moment-timezone';
import 'moment/locale/ru';

import nconf from 'nconf';

import { resolve, parse } from 'url';
import { get, trimEnd } from 'lodash';
import { to } from 'await-to-js';
import { ParsedUrlQuery } from 'querystring';
import { stringify } from 'circular-json';

import express, { Router, Application, Response, Request } from 'express';
import * as builder from 'botbuilder';
import { ChatConnector, MemoryBotStorage, UniversalBot } from 'botbuilder';

// configs
const config = nconf.env().file({file: './config/dev.json'});
const req = request.defaults(config.get('http:headers'));

moment.tz.setDefault(config.get('system.timezone'));
prettyError.start();
// end configs

// ???
class Bot {
    private config = config.get('system');

    private app: Application;
    private connector: ChatConnector;
    private storage: MemoryBotStorage;
    private bot: UniversalBot;

    public constructor() {
        this.setupBot();
        this.setupServer();
    }

    private setupBot(): void {
        this.connector = new ChatConnector({
            appId:       this.config.appId,
            appPassword: this.config.appPassword,
            gzipData: true,
        });

        this.storage = new MemoryBotStorage();

        this.bot = new UniversalBot(
            this.connector, session => {
                session.send(`>>> ${session.message.text}`);
            }
        ).set('storage', this.storage);
    }

    private setupServer() {
        this.app = express();
        this.setupApp([
            express.urlencoded({ extended: true }),
            express.json(),
        ]);

        this.app.post('/api/messages', this.connector.listen());

        this.app.listen(this.config.server.port);
    }

    private setupApp(middlewares: any[]) {
        for (const middleware of middlewares) {
            this.app.use(middleware);
        }
    }
}

(async () => {
    new Bot();
})();
