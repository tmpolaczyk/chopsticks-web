Button to scan local ports in settings tab
* Check if it works from deployed in github, it should because we start zombienet with cors-all flag

Info about channels tanssi -> ethereum
We have ethereum -> tanssi but not the other way
Would be really nice to find the relayer tx in etherscan, to see who got the reward (frontrunning issue)

Block weight visualizer
* A correct one
Block view: total block weight, reserved, inherents, etc
Tx view: for a single tx, check the estimated max weight vs the actual weight, and use chopsticks for actual number of reads and writes if possible
Some kind of graph, not a pie chart

Validator info:
session.validators
external validators pallet
grandpa.authorities
era info, session info
I want to know:
* If the next validators have changed, see the change
* See when the change will happen
Also, if a validator is not selected, I want to know why:
* Does the account have existential deposit?
* Does it have keys?
* Is it whitelisted or blacklisted?
* Is it from ethereum?


Clock
* % progress of current session and era
* estimate of when the next era will be, in time and in block number
* block time graphs, average, expected, etc
