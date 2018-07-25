import 'source-map-support/register';
import prettyError from 'pretty-error';

import nconf from 'nconf';

import express, { Application } from 'express';
import {
    CardAction,
    ChatConnector, HeroCard,
    IAddress,
    IContactRelationUpdate,
    IConversationUpdate,
    MemoryBotStorage,
    Message,
    Prompts,
    Session,
    UniversalBot,
    VideoCard
} from 'botbuilder';
import NeDB from 'nedb';

// configs
const config = nconf.env().file({file: './config/dev.json'});
prettyError.start();

// Bot
class Bot {
    private config = config.get('system');

    private app: Application;
    private connector: ChatConnector;
    private storage: MemoryBotStorage;
    private bot: UniversalBot;
    private users: NeDB;
    private chats: NeDB;
    private readonly CODE = '4 8 15 16 23 42';

    public constructor() {
        this.setupBot();
        this.setupServer();
        this.connectDb();
    }

    private connectDb(): void {
        this.users = new NeDB({
            filename: 'users.json',
            autoload: true,
        });

        this.chats = new NeDB({
            filename: 'chat.json',
            autoload: true,
        });
    }

    private setupBot(): void {
        this.connector = new ChatConnector({
            appId:       this.config.appId,
            appPassword: this.config.appPassword,
            gzipData:    true,
        });

        this.storage = new MemoryBotStorage();

        this.bot = new UniversalBot(
            this.connector,
            (session: Session) => session.replaceDialog('default'),
        ).set('storage', this.storage);

        this.bot.dialog('default', [
            (session: Session, args, next) => {
                if (!session.message.address.conversation.isGroup) {
                    let db = Promise.resolve();

                    const nonAuthButtons = [
                        CardAction.postBack(session, 'GO_CODE', 'Ввести код'),
                    ];

                    const loggedButton = [
                        CardAction.postBack(session, 'GO_SEND', 'Отправить рассылку'),
                    ];

                    if (!session.userData.userLoaded) {
                        session.userData.userLoaded = true;

                        db = new Promise((resolve) => {
                            this.users.findOne({userId: {$eq: session.message.address.user.id}}, (user) => {
                                if (user) {
                                    session.userData.userLogged = true;
                                }

                                resolve();
                            });
                        });
                    }

                    db.then(() => {
                        const card = new HeroCard(session)
                            .title('Привет!')
                            .subtitle(session.message.address.user.name)
                            .text('Вам доступны следующие функции')
                            .buttons([
                                ...(session.userData.userLogged ? loggedButton : nonAuthButtons),
                                CardAction.postBack(session, 'GO_HELP', 'Справка'),
                            ]);

                        const message = new Message(session).addAttachment(card);
                        return Prompts.text(session, message);
                    });

                } else {
                    console.log(JSON.stringify(session.message.address));
                    this.bot.send(new Message().address(session.message.address).text('test'));
                    session.endDialog();
                }
            },

            (session: Session, {response}) => {
                if (response === 'GO_CODE') {
                    return session.replaceDialog('code');
                }

                if (response === 'GO_SEND') {
                    return session.replaceDialog('send');
                }

                session.replaceDialog('default');
            },
        ]);

        this.bot.customAction({
            matches: /^reset$/i,
            onSelectAction: (session) => {
                session.userData = {};
                session.clearDialogStack().beginDialog('default', {});
            }
        });

        this.bot.dialog('code', [
            (session: Session) => {
                Prompts.text(session, 'Введите код доступа');
            },

            (session: Session, results) => {
                if (results.response === this.CODE) {
                    session.userData.userLoaded = false;
                    this.users.insert({userId: session.message.address.user.id});

                    session.send('Код принят');
                    session.replaceDialog('default');
                } else {
                    session.send('Неправильный код');
                    session.replaceDialog('default');
                }
            }
        ]);

        this.bot.dialog('help', (session: Session) => {
            session.send('Справочное сообщение бла бла бла...');
            session.replaceDialog('default');

        }).triggerAction({
            matches: /^GO_HELP$/,
        });

        this.bot.dialog('send', [
            (session: Session) => {
                if (!session.userData.userLogged) {
                    return session.replaceDialog('default');
                }

                Prompts.text(session, 'Введите текст сообщения для рассылки', {
                    minLength: 1,
                    retryPrompt: 'Введите непустое сообщение'
                });
            },

            (session: Session, {response}) => {
                const card = new HeroCard(session)
                    .title('Подтвердите отправку')
                    .subtitle('Ваше сообщение:')
                    .text(response)
                    .buttons([
                        CardAction.postBack(session, 'GO_SEND_CONFIRM', 'Отправить'),
                        CardAction.postBack(session, 'GO_CANCEL', 'Отмена'),
                    ]);

                session.userData.message = response;

                const message = new Message(session).addAttachment(card);
                return Prompts.text(session, message);
            },

            (session: Session, {response}) => {
                const messageText = session.userData.message;
                delete session.userData.message;

                if (response === 'GO_CANCEL') {
                    return session.replaceDialog('default');
                }

                if (response === 'GO_SEND_CONFIRM') {
                    session.send('Рассылка начата...');

                    this.chats.getAllData().forEach(chat => {
                        const message = new Message().address(chat.chat).text(messageText);
                        this.bot.send(message);
                    });

                    return session.endDialog('Рассылка завершена...');
                }
        }]).triggerAction({
            matches: /^GO_SEND$/,
        }).cancelAction('cancelAction', 'Отменено', {
            matches: /^GO_CANCEL$|^Отмена$/i,
        });

        this.bot.dialog('demo', (session: Session) => {
            session.endDialog('pong!');
        }).triggerAction({
            matches: /^ping$/i,
        });

        this.bot.on('conversationUpdate', (update: IConversationUpdate) => {
            const self = update.address.bot.id;
            const findHelper = (item: IAddress['bot']) => item.id === self;

            if (update.membersAdded && update.membersAdded.find(findHelper)) {
                this.chats.insert({chat: update.address});

                const reply = new Message()
                    .address(update.address)
                    .text('Всем привет! Канал добавлен в рассылку.');

                return this.bot.send(reply);
            }

            if (update.membersRemoved && update.membersRemoved.find(findHelper)) {
                this.chats.remove({chat: update.address});
            }
        });

        this.bot.on('contactRelationUpdate', (update: IContactRelationUpdate) => {
            if (update.action === 'add') {
                const reply = new Message()
                    .address(update.address)
                    .text('Привет! Напиши мне что-нибудь для начала.');

                return this.bot.send(reply);
            }
        });

        this.bot.on('error', e => {
            console.log('And error ocurred', e);
        });
    }

    private setupServer() {
        this.app = express();
        this.setupWebApp([
            express.urlencoded({ extended: true }),
            express.json(),
        ]);

        this.app.post('/', this.connector.listen());
        this.app.listen(this.config.server.port);
    }

    private setupWebApp(middlewares: any[]) {
        for (const middleware of middlewares) {
            this.app.use(middleware);
        }
    }
}

(async () => {
    new Bot();
})();
