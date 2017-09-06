const dotenv     = require('dotenv').config();
const moment     = require('moment');
const Botkit     = require('botkit');
const fetch      = require('node-fetch');
const emojiStrip = require('emoji-strip');

const whitelist = process.env.WHITELIST.split(',');


// Setup ===============================================

if (!process.env.BOT_TOKEN) {
  process.exit(1);
}

const controller = Botkit.slackbot({
  interactive_replies: true
});

controller.setupWebserver(process.env.PORT, function(err, webserver) {
  controller.createHomepageEndpoint(controller.webserver);
});

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

const getHarvestData = (department) => {
  const now = moment().format('YYYYMMDD');
  const then = moment().startOf('isoWeek').format('YYYYMMDD');
  return fetch(`http://time-is-a-flat-circle.herokuapp.com/api/report?from=${then}&to=${now}&department=${department}`).then(response => response.json());
};

const getTargetHours = () => {
  const isWeekend = moment().isoWeekday() >= 6;
  const isBeforeBusiness = moment().isBefore(moment().startOf('day').add(9, 'hours'));
  const isAfterBusiness = moment().isAfter(moment().startOf('day').add(18, 'hours'));
  if (isWeekend) {
    return 30;
  } else if (isBeforeBusiness) {
    return (moment().isoWeekday() - 1) * 6;
  } else if (isAfterBusiness) {
    return moment().isoWeekday() * 6;
  } else {
    return (((moment().isoWeekday() - 1) + (((moment().hour() - 9) + (moment().minute() / 60)) / 9)) * 6) - 3;
  }
};

const identifyPeopleInDanger = harvestData => {
  return harvestData.totals.filter(person => person.billableHours < getTargetHours());
};

const sendMessage = (offender, slackId) => {
  bot.startPrivateConversation({user: slackId.id}, (err, convo) => {
    convo.say(`Hi! Just wanted to let you know that your billable hours were looking kinda low for this week. You've currently tracked ${offender.billableHours} hours and you should be at roughly ${getTargetHours()}. ok, byeeeeeeeeeeeeee.`);
  });
};

const sendMessages = values => {
  const idMap = values[0];
  const offenders = values[1];
  offenders.forEach(offender => {
    const slackId = idMap.find(item => item.name === offender.name);
    if (slackId !== undefined) {
      sendMessage(offender, slackId);
    }
  });
};

const getUserIdMap = () => {
  return getUsers(bot)
    .then(filterBVAUsers)
    .then(createUserIdMap);
};

const getPeopleInDanger = (department) => {
  return getHarvestData(department)
    .then(identifyPeopleInDanger);
};

const sendReminders = (department) => {
  return Promise.all([getUserIdMap(), getPeopleInDanger(department)])
    .then(sendMessages);
};

const getLongestName = names => {
  return names.reduce((name, longestName) => (name.length > longestName.length) ? name : longestName);
};

const buildReport = harvestData => {
  const names = harvestData.map(total => total.name);
  const longestNameLength = getLongestName(names).length;
  const heading = `NAME:${' '.repeat(longestNameLength - 3)}BILLABLE:  TOTAL:\n`;
  let message = heading;
  harvestData.forEach(total => {
    const offset = longestNameLength - total.name.length + 2;
    const fixedBillableHours = parseFloat(total.billableHours).toFixed(2);
    const fixedTotalHours = parseFloat(total.totalHours).toFixed(2);
    const billableHours = (fixedBillableHours.length === 4) ? ' ' + fixedBillableHours : fixedBillableHours;
    const totalHours = (fixedTotalHours.length === 4) ? ' ' + fixedTotalHours : fixedTotalHours;
    message += `${total.name}${' '.repeat(offset)}${billableHours}${' '.repeat(6)}${totalHours}\n`;
  });
  return message;
};


// Listeners  ===============================================

controller.hears([/hi/i], ['direct_message'], (bot, message) => {
  bot.reply(message, 'heysup.');
});

controller.hears([/help/i], ['direct_message'], (bot, message) => {
  bot.reply(message, 'Available Departments:```Development\nDesign\nPaid Media\nAffiliate\nPMO\nAccount Strategy\nCRO\nSales```');
});

controller.hears([/report ([\s\S]+)/i], ['direct_message'], (bot, message) => {
  const departments = ['Development', 'Design', 'Paid Media', 'Affiliate', 'PMO', 'Account Strategy', 'CRO', 'Sales'];
  const department = message.match[1];

  if (!whitelist.includes(message.user)) {
    bot.reply(message, 'Sorry, you are not authorized.');
  } else {
    if (!departments.includes(department)) {
      bot.reply(message, 'You asked for a report on a non-existent department. To see all available departments ask me for "help"');
    } else {
      getHarvestData(department)
        .then(harvestData => harvestData.totals)
        .then(buildReport)
        .then(report => {
          bot.reply(message, '```' + report + '```');
        });
    }
  }
});

controller.hears([/hours/i], ['direct_message'], (bot, message) => {
  bot.reply(message, 'Please wait...');
  const userId = message.user;
  Promise.all([getUserIdMap(), getHarvestData('All')])
    .then(values => {
      const idMap = values[0];
      const harvestData = values[1];
      const user = idMap.find(item => item.id === userId);
      const userData = harvestData.totals.filter(person => person.name === user.name);
      bot.reply(message, '```' + buildReport(userData) + '```');
    });
});


controller.on('rtm_open', bot => {
  console.log('** The RTM api just connected: ' + bot.identity.name);
});

module.exports = {
  sendReminders: sendReminders,
  // sendReport: sendReport
};
