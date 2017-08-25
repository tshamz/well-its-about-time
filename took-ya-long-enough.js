const dotenv     = require('dotenv').config();
const moment     = require('moment');
const Botkit     = require('botkit');
const fetch      = require('node-fetch');
const emojiStrip = require('emoji-strip');

// Setup ===============================================

if (!process.env.BOT_TOKEN) {
  process.exit(1);
}

const controller = Botkit.slackbot();
const bot = controller.spawn({
  token: process.env.BOT_TOKEN
});

bot.startRTM((err, bot, payload) => {
  if (err) {
    throw new Error(err);
  }
});

// Helper Functions ===============================================

const getUsers = bot => {
  return new Promise((resolve, reject) => {
    bot.api.users.list({}, (err, response) => {
      resolve(response.members);
    });
  })
};

const filterBVAUsers = members => {
  return members.filter(member => !member.deleted && !member.is_restricted && !member.is_bot);
};

const createUserIdMap = users => {
  return users.map(user => ({name: emojiStrip(user.real_name), id: user.id}));
};

const getHarvestData = (filters) => {
  const now = moment().format('YYYYMMDD');
  const then = moment().startOf('isoWeek').format('YYYYMMDD');
  return fetch(`http://time-is-a-flat-circle.herokuapp.com/api/report?from=${then}&to=${now}&department=Development`).then(response => response.json());
};

const getTargetHours = () => {
  // const dayOfWeek = moment().isoWeekday();
  // const isWeekend = (dayOfWeek >= 6) ? true : false;
  // const startOfBusiness = moment().startOf('day').add(9, 'hours');
  // const endOfBusiness = moment().startOf('day').add(18, 'hours');
  // const isAfterBusiness = moment().isAfter(endOfBusiness);
  // const isBeforeBusiness = moment().isBefore(startOfBusiness);
  return (moment().isoWeekday() - 1) * 6;
};

const identifyPeopleInDanger = people => {
  return people.totals.filter(person => person.billableHours < getTargetHours());
};

const sendMessage = (offender, slackId) => {
  bot.startPrivateConversation({user: slackId.id}, (err, convo) => {
    convo.say(`Hi! Just wanted to let you know that your billable hours were looking kinda low for this week`);
    convo.say(`You've currently tracked ${offender.billableHours} hours and the target as of this morning was 24.`);
    convo.say(`kk, byeeeeeeeeeeeeee.`);
  });
};

const sendMessages = values => {
  const idMap = values[0];
  const offenders = values[1];
  offenders.forEach(offender => {
    const slackId = idMap.find(item => item.name === offender.name);
    sendMessage(offender, slackId);
  });
};

const getUserIdMap = getUsers(bot)
  .then(createUserIdMap);

const getPeopleInDanger = getHarvestData()
  .then(identifyPeopleInDanger);

const sendReminders = () => {
  Promise.all([getUserIdMap, getPeopleInDanger])
    .then(sendMessages);
};


// Listeners  ===============================================

controller.hears([/hi/], ['direct_message'], (bot, message) => {
  bot.reply(message, 'heysup.');
});

controller.on('rtm_open', bot => {
  console.log('** The RTM api just connected: ' + bot.identity.name);
  getPeopleInDanger.then(people => console.log(people))
});

module.exports = {
  sendReminders: sendReminders
};
