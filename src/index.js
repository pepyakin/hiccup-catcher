#!/usr/bin/node

import { ApiPromise, WsProvider } from '@polkadot/api'
import { cryptoWaitReady } from '@polkadot/util-crypto'
import chalk from 'chalk'

async function connect(port, types) {
	const provider = new WsProvider('ws://127.0.0.1:' + port)
	const api = new ApiPromise({ provider, types })
	await api.isReady
	return api
}

// Resolves
function waitForNewFinalized(api, lastFinalized) {
	return new Promise(async function (resolve, reject) {
		const unsubscribe = await api.rpc.chain.subscribeFinalizedHeads((header) => {
			if (header.number > lastFinalized) {
				unsubscribe()
				resolve(header)
			}
		})
	})
}

function oppositeEventName(eventName) {
	if (eventName == "backed") {
		return "included"
	} else if (eventName == "included") {
		return "backed"
	} else {
		throw `unknown eventName: ${eventName}`
	}
}

function noteEvent(candidateEvents, blockNumber, paraId, eventName) {
	let hiccup = null

	if (paraId in candidateEvents) {
		let ev = candidateEvents[paraId]

		if (ev.blockNumber != blockNumber - 1 || ev.eventName != oppositeEventName(eventName)) {
			hiccup = {
				paraId,
				trigger: {
					eventName, blockNumber,
				},
				last: ev,
			}
		}
	}

	candidateEvents[paraId] = {
		blockNumber,
		eventName,
	}

	return hiccup
}

function displayHiccups(blockNumber, hiccups) {
	console.log(`Block ${blockNumber} had ${hiccups.length} hiccups`)

	hiccups.forEach((hiccup) => {
		console.log(
`  Id(${hiccup.paraId}): ${chalk.red(hiccup.trigger.eventName)} while last event was ${chalk.green(hiccup.last.eventName)} at ${hiccup.last.blockNumber} (${hiccup.trigger.blockNumber - hiccup.last.blockNumber} blocks stall)`
		)
	})
}

function triageCandidateEvents(api, candidateEvents, blockNumber, events) {
	let hiccups = []

	events.forEach(({ event }) => {
		let paraId
		let eventName

		if (api.events.inclusion.CandidateBacked.is(event)) {
			const [receipt] = event.data
			paraId = receipt.descriptor.paraId
			eventName = "backed"
		} else if (api.events.inclusion.CandidateIncluded.is(event)) {
			const [receipt] = event.data
			paraId = receipt.descriptor.paraId
			eventName = "included"
		} else {
			return // from the inner closure
		}

		let hiccup = noteEvent(
			candidateEvents,
			blockNumber,
			paraId,
			eventName
		)
		if (hiccup) {
			hiccups.push(hiccup)
		}
	})

	if (hiccups.length > 0) {
		displayHiccups(blockNumber, hiccups)
	}
}

async function main() {
	await cryptoWaitReady()
	let api = await connect(9944, {})

	// parachain id -> candidate info
	var candidateEvents = {}
	var lastFinalized = 0

	while (true) {
		let nextFinalizedHeader = await waitForNewFinalized(api, lastFinalized)
		console.log(`Chain is at block: #${nextFinalizedHeader.number}`)

		// We iterate until the penultimate block otherwise `getBlockHash` fails with decoding error.
		for (let blockNumber = lastFinalized; blockNumber < nextFinalizedHeader.number; blockNumber++) {
			const blockHash = await api.rpc.chain.getBlockHash(blockNumber)
			const events = await api.query.system.events.at(blockHash)

			triageCandidateEvents(api, candidateEvents, blockNumber, events)
		}

		lastFinalized = nextFinalizedHeader.number
	}
}

main().catch(console.error)
