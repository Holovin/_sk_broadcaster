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

// configs
const config = nconf.env().file({file: './config/dev.json'});
const req = request.defaults(config.get('http:headers'));

moment.tz.setDefault(config.get('system.timezone'));
prettyError.start();
// end configs

console.log('test ok!');
