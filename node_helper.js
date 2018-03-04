"use strict";

const NodeHelper = require("node_helper");
const CallMonitor = require("node-fritzbox-callmonitor");
const vcard = require("vcard-json");
const phoneFormatter = require("phone-formatter");
const xml2js = require("xml2js");
const moment = require('moment');
const exec = require('child_process').exec;
const PythonShell = require('python-shell');
const path = require("path");
//Ergänzungen ADR
var request = require('request');
var cheerio = require('cheerio');
var fs      = require('fs');
var url = 'http://www.dasoertliche.de/?form_name=search_inv&ph=';
var title = '';
var adresse = '';
var anrufer = 'kein Treffer auf Örtliche.de';
//Ergänzungen ADR

const CALL_TYPE = Object.freeze({
	INCOMING : "1",
	MISSED : "2",
	OUTGOING : "3"
})
// outgoing missed calls are not in the list

module.exports = NodeHelper.create({
	// Subclass start method.
	start: function() {
		this.started = false;
		//create adressbook dictionary
		this.AddressBook = {};
		console.log("Starting module: " + this.name);
	},

	normalizePhoneNumber(number) {
		return phoneFormatter.normalize(number.replace(/\s/g, ""));
	},

	getName: function(number) {
		//Normalize number
		var number_formatted = this.normalizePhoneNumber(number);
		//Check if number is in AdressBook if yes return the name
		if (number_formatted in this.AddressBook) {
			return this.AddressBook[number_formatted];
		} else {
			//Not in AdressBook return original number
			return number;
		}
	},

//Ergänzungen ADR
	getName2: function(number) {
		//Normalize number
		var number_formatted = this.normalizePhoneNumber(number);
		//Check if number is in AdressBook if yes return the name
		if (number_formatted in this.AddressBook) {
			console.log(moment().format("DD.MM.YYYY HH:mm") + ' Anrufer: ' + number + ' ' + this.AddressBook[number_formatted]);//ADR
			return this.AddressBook[number_formatted];
		} else {
			//Not in AdressBook return original number
			//Ergänzungen ADR -Reverse Lookup
			request(url + number, function (error, response, html) {
				if (!error) {
				  var $ = cheerio.load(html);
				  
				  $('.left').filter(function(){
					  var data = $(this);
					  title = data.text().trim();
					  adresse = data.children().eq(2).text().trim();
					  })
					  
				  $('.name ').filter(function(){
					  var data = $(this);
					  anrufer = data.text().trim();
					  })
				}
				else {
				  console.log(moment().format("DD.MM.YYYY HH:mm") + ' Fehler im Websiteparsing aufgetreten: ' + error);
				}
			  });

			  if (anrufer === 'kein Treffer auf Örtliche.de') {
				  	console.log(moment().format("DD.MM.YYYY HH:mm") + ' Anrufer Lookup: ' + number + ' - ' + anrufer + ', ' + adresse);
				  	return number + ' (kein LookUp mgl.)';
				} else {
					console.log(moment().format("DD.MM.YYYY HH:mm") + ' Anrufer Lookup: ' + number + ' - ' + anrufer + ', ' + adresse);
					return anrufer + ", " + adresse + ' (' + number + ')';
				}
			//console.log(moment().format("DD.MM.YYYY HH:mm") + ' Anrufer Lookup: ' + number + ' - ' + anrufer + ', ' + adresse);
			//return number + '\n' + anrufer + ", " + adresse;
		}
	},
//Ergänzungen ADR

	socketNotificationReceived: function(notification, payload) {
		//Received config from client
		if (notification === "CONFIG") {
			//set config to config send by client
			this.config = payload;
			//if monitor has not been started before (makes sure it does not get started again if the web interface is reloaded)
			if (!this.started) {
				//set started to true, so it won't start again
				this.started = true;
				console.log("Received config for " + this.name);

				this.parseVcardFile();
				this.setupMonitor();
			};
			//send fresh data to front end (page might have been refreshed)
			if (this.config.password !== "")
			{
				this.loadDataFromAPI();
			}
		}
		if (notification === "RELOAD_CALLS") {
			this.loadDataFromAPI("--calls-only");
		}
		if (notification === "RELOAD_CONTACTS") {
			this.loadDataFromAPI("--contacts-only");
		}
	},

	setupMonitor: function() {
		//helper variable so that the module-this is available inside our callbacks
		var self = this;

		//Set up CallMonitor with config received from client
		var monitor = new CallMonitor(this.config.fritzIP, this.config.fritzPort);

		//Incoming call
		monitor.on("inbound", function(call) {
			//If caller is not empty
			if (call.caller != "") {
				self.sendSocketNotification("call", self.getName2(call.caller));//Ergänzungen ADR, mit der Funktion 2 versehen
				fs.appendFile('anrufe.txt', moment().format("DD.MM.YYYY HH:mm") + ' Gesamt: ' + call.caller + ' ' + self.getName2(call.caller) +'\n', function(err){ //Ergänzungen ADR, mit der Funktion 2 versehen
				console.log('anrufe.txt erfolgreich geschrieben'); //Ergänzungen ADR, mit der Funktion 2 versehen
				  })
			} else {//Ergänzungen ADR, mit der Funktion 2 versehen
				//ADR unterdrückter Rufnummer
				//self.sendSocketNotification("call", ' mit unterdrückter Rufnummer');//Ergänzungen ADR, muss inaktiv sein, da Alert nicht mehr verschwindet
				fs.appendFile('anrufe.txt', moment().format("DD.MM.YYYY HH:mm") + ' Gesamt: Anrufer mit unterdrückter Rufnummer' + '\n', function(err){ //Ergänzungen ADR
				console.log('Anrufer mit unterdrückter Rufnummer'); //Ergänzungen ADR
				})
			};
		});

		//Call accepted
		monitor.on("connected", function(call) {
			self.sendSocketNotification("connected", self.getName2(call.caller));//Ergänzungen ADR, mit der Funktion 2 versehen
		});

		//Caller disconnected
		monitor.on("disconnected", function(call) {
			//send clear command to interface
			self.sendSocketNotification("disconnected", {"caller": self.getName2(call.caller), "duration": call.duration});//Ergänzungen ADR, mit der Funktion 2 versehen
		});
		console.log(this.name + " is waiting for incoming calls.");
	},

	parseVcardFile: function() {
		var self = this;

		if (!this.config.vCard) {
			return;
		}
		vcard.parseVcardFile(self.config.vCard, function(err, data) {
			//In case there is an error reading the vcard file
			if (err) {
				self.sendSocketNotification("error", "vcf_parse_error");
				if (self.config.debug) {
					console.log("[" + self.name + "] error while parsing vCard " + err);
				}
				return
			}

			//For each contact in vcf file
			for (var i = 0; i < data.length; i++) {
				//For each phone number in contact
				for (var a = 0; a < data[i].phone.length; a++) {
					//normalize and add to AddressBook
					self.AddressBook[self.normalizePhoneNumber(data[i].phone[a].value)] = data[i].fullname;
				}
			}
			self.sendSocketNotification("contacts_loaded", Object.keys(self.AddressBook).length);
		});
	},

	loadCallList: function(body) {
		var self = this;

		xml2js.parseString(body, function (err, result) {
			if (err) {
				self.sendSocketNotification("error", "calllist_parse_error");
				console.error(self.name + " error while parsing call list: " + err);
				return;
			}
			var callArray = result.root.Call;
			var callHistory = []

			for (var index in callArray)
			{
				var call = callArray[index];
				var type = call.Type[0];
				if (type == CALL_TYPE.MISSED || type == CALL_TYPE.INCOMING)
				{
					if (type == CALL_TYPE.INCOMING && self.config.deviceFilter && self.config.deviceFilter.indexOf(call.Device[0]) > -1) {
						continue;
					}
					var callInfo = {"time": moment(call.Date[0], "DD.MM.YY HH:mm"), "caller": self.getName(call.Caller[0])};
					if (call.Name[0])
					{
						callInfo.caller = call.Name[0];
					}
					callHistory.push(callInfo)
				}
			}
			self.sendSocketNotification("call_history", callHistory);
		});
	},

	loadPhonebook: function(body) {
		var self = this;

		xml2js.parseString(body, function (err, result) {
			if (err) {
				self.sendSocketNotification("error", "phonebook_parse_error");
				if (self.config.debug) {
					console.error(self.name + " error while parsing phonebook: " + err);
				}
				return;
			}
			var contactsArray = result.phonebooks.phonebook[0].contact;
			for (var index in contactsArray)
			{
				var contact = contactsArray[index];


				var contactNumbers = contact.telephony[0].number;
				var contactName = contact.person[0].realName;

				for (var index in contactNumbers)
				{
					var currentNumber = self.normalizePhoneNumber(contactNumbers[index]._);
					self.AddressBook[currentNumber] = contactName[0];
				}
			}
			self.sendSocketNotification("contacts_loaded", Object.keys(self.AddressBook).length);
		});
	},

	loadDataFromAPI: function(additionalOption) {
		var self = this;

		if (self.config.debug) {
			console.log('Starting access to FRITZ!Box...');
		}

		var args = ['-i', self.config.fritzIP, '-p', self.config.password];
		if (self.config.username !== "")
		{
			args.push('-u');
			args.push(self.config.username);
		}
		if (additionalOption)
		{
			args.push(additionalOption);
		}

		var options = {
			mode: 'json',
			scriptPath: path.resolve(__dirname),
			args: args
		};

		var pyshell = new PythonShell('fritz_access.py', options);

		pyshell.on('message', function (message) {
			if (message.filename.indexOf("calls") !== -1)
			{
				// call list file
				self.loadCallList(message.content);
			} else {
				// phone book file
				self.loadPhonebook(message.content);
			}
		});

		// end the input stream and allow the process to exit
		pyshell.end(function (error) {
			if (error) {
				var errorUnknown = true;
				if (error.traceback.indexOf("XMLSyntaxError") !== -1) {
					// password is probably wrong
					self.sendSocketNotification("error", "login_error");
					errorUnknown = false;
				}
				if (error.traceback.indexOf("failed to load external entity") !== -1) {
					// probably no network connection
					self.sendSocketNotification("error", "network_error");
					errorUnknown = false;
				}
				if (errorUnknown) {
					self.sendSocketNotification("error", "unknown_error");
				}
				if (self.config.debug) {
					console.error(self.name + " error while accessing FRITZ!Box: ");
					console.error(error.traceback);					
				}
				return;
			}
			if (self.config.debug) {
				console.log('Access to FRITZ!Box finished.');
			}
		});
	}
});
