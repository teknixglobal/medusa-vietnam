# @teknixglobal/medusa-vietnam-core

Shared helpers for the Vietnamese payment providers in [medusa-vietnam](https://github.com/teknixglobal/medusa-vietnam): VND amounts, HMAC and constant-time compare, return URL allow-list, the `next_action` type, vi/en labels, and `TeknixPaymentProviderBase` (base class for payment providers that carries the Medusa behaviour fixes in [FIXES.md](../../FIXES.md); new providers extend it and implement `updateSessionData` instead of `updatePayment`). Installed as a dependency of the gateway packages; you do not need to install it yourself.
