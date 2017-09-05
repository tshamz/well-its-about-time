const dotenv     = require('dotenv').config();
const moment     = require('moment');
const Botkit     = require('botkit');
const fetch      = require('node-fetch');
const emojiStrip = require('emoji-strip');

const whitelist = ['U03KK5BP8', 'U02RV1ALZ'];


// Setup ===============================================

if (!process.env.BOT_TOKEN) {
  process.exit(1);
}

const controller = Botkit.slackbot({
  interactive_replies: true,
  clientId: '2334831841.237697237751',
  clientSecret: 'c926d6a2513bf268e321c094b04c96ec',
  scopes: ['bot'],
  debug: false
});

controller.setupWebserver(process.env.PORT, function(err, webserver) {
  if (err) {
    throw new Error(err);
  }
  controller.createWebhookEndpoints(controller.webserver);
  controller.createHomepageEndpoint(controller.webserver);
  controller.createOauthEndpoints(controller.webserver, function(err, req, res) {
    if (err) {
      res.status(500).send('ERROR: ' + err);
    } else {
      res.send('Great Success!');
    }
  });
});

var _bots = {};
var trackBot = function(bot) {
  _bots[bot.config.token] = bot;
};

controller.on('create_bot',function(bot, config) {
  if (_bots[bot.config.token]) {
    // already online! do nothing.
  } else {
    bot.startRTM(function(err) {
      if (!err) {
        trackBot(bot);
      }
    });
    bot.startPrivateConversation({user: config.createdBy}, function(err, convo) {
      if (err) {
        console.log(err);
      } else {
        convo.say('Hi! You created me!');
      }
    });
  }
});

controller.storage.teams.all(function(err, teams) {
  if (err) {
    throw new Error(err);
  }
  for (var t in teams) {
    if (teams[t].bot) {
      controller.spawn(teams[t]).startRTM(function(err, bot) {
        if (err) {
          console.log('Error connecting bot to Slack:', err);
        } else {
          trackBot(bot);
        }
      });
    }
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

controller.on('interactive_message_callback', (bot, message) => {

  console.log(message);

  if (message.callback_id === 'which_department') {
    getHarvestData(message.actions[0])
      .then(harvestData => harvestData.totals)
      .then(buildReport)
      .then(report => {
        bot.replyInteractive(message, '```' + report + '```');
      });
    console.log('ding');
  }

});

controller.hears([/hi/i], ['direct_message'], (bot, message) => {
  bot.reply(message, 'heysup.');
});

controller.hears([/report/i], ['direct_message'], (bot, message) => {
  if (whitelist.includes(message.user)) {
    bot.reply(message, {
      replace_original: true,
      attachments: [{
        title: 'Which department would you like a report for?',
        callback_id: 'which_department',
        attachment_type: 'default',
        actions: [
          {
            "name": "development",
            "text": "Development",
            "value": "Development",
            "type": "button",
          },
          {
            "name": "design",
            "text": "Design",
            "value": "Design",
            "type": "button",
          },
          {
            "name": "paid Media",
            "text": "Paid Media",
            "value": "Paid%20Media",
            "type": "button",
          },
          {
            "name": "affiliate",
            "text": "Affiliate",
            "value": "Affiliate",
            "type": "button",
          },
          {
            "name": "pmo",
            "text": "PMO",
            "value": "PMO",
            "type": "button",
          },
          {
            "name": "account Strategy",
            "text": "Account Strategy",
            "value": "Account%20Strategy",
            "type": "button",
          },
          {
            "name": "cRO",
            "text": "CRO",
            "value": "CRO",
            "type": "button",
          },
          {
            "name": "sales",
            "text": "Sales",
            "value": "Sales",
            "type": "button",
          },
          {
            "name": "all",
            "text": "All",
            "value": "All",
            "type": "button",
          }
        ]
      }]
    })
  }
});

controller.hears([/hours/i], ['direct_message'], (bot, message) => {
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
