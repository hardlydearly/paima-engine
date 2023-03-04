import web3UtilsPkg from 'web3-utils';

import type { UserSignature } from '@paima/utils';
import { hexStringToUint8Array } from '@paima/utils';

import type { CardanoApi, OldResult, Result, Wallet } from '../types';
import {
  cardanoConnected,
  getCardanoActiveWallet,
  getCardanoAddress,
  getCardanoApi,
  setCardanoActiveWallet,
  setCardanoAddress,
  setCardanoApi,
  setCardanoHexAddress,
} from '../state';
import { RustModule } from '../helpers/rust-loader';
import {
  buildEndpointErrorFxn,
  PaimaMiddlewareErrorCode,
  FE_ERR_SPECIFIC_WALLET_NOT_INSTALLED,
} from '../errors';
import { WalletMode } from './wallet-modes';

const { utf8ToHex } = web3UtilsPkg;

const SUPPORTED_WALLET_IDS = ['nami', 'nufi', 'flint', 'eternl'];

export async function initCardanoLib(): Promise<void> {
  await RustModule.load();
}

export async function cardanoLoginSpecific(walletId: string): Promise<void> {
  if (getCardanoActiveWallet() === walletId) {
    return;
  }

  if (!SUPPORTED_WALLET_IDS.includes(walletId)) {
    throw new Error(`[cardanoLoginSpecific] Cardano wallet "${walletId}" not supported`);
  }

  const api = await (window as any).cardano[walletId].enable();
  setCardanoApi(api);
  const hexAddress = await pickCardanoAddress(api);
  const addrArray = hexStringToUint8Array(hexAddress);
  const userAddress = RustModule.CardanoAddress.from_bytes(addrArray).to_bech32();
  setCardanoAddress(userAddress);
  setCardanoHexAddress(hexAddress);
  setCardanoActiveWallet(walletId);
}

export async function cardanoLoginAny(): Promise<void> {
  if (cardanoConnected()) {
    return;
  }
  let error: any;
  for (const walletId of SUPPORTED_WALLET_IDS) {
    try {
      await cardanoLoginSpecific(walletId);
      if (cardanoConnected()) {
        break;
      }
    } catch (err) {
      error = err;
    }
  }
  if (!cardanoConnected()) {
    console.log('[cardanoLoginAny] error while attempting login:', error);
    throw new Error('[cardanoLogin] Unable to connect to any supported Cardano wallet');
  }
}

async function pickCardanoAddress(api: CardanoApi): Promise<string> {
  const addresses = await api.getUsedAddresses();
  if (addresses.length > 0) {
    return addresses[0];
  }

  const unusedAddresses = await api.getUnusedAddresses();
  if (unusedAddresses.length > 0) {
    return unusedAddresses[0];
  }

  throw new Error('[pickCardanoAddress] no used or unused addresses');
}

export async function signMessageCardano(
  userAddress: string,
  message: string
): Promise<UserSignature> {
  await cardanoLoginAny();
  const api = getCardanoApi();
  const hexMessage = utf8ToHex(message).slice(2);
  const { signature, key } = await api.signData(userAddress, hexMessage);
  return `${signature}+${key}`;
}

export async function checkCardanoWalletStatus(): Promise<OldResult> {
  const errorFxn = buildEndpointErrorFxn('checkCardanoWalletStatus');

  if (getCardanoAddress() === '') {
    return errorFxn(PaimaMiddlewareErrorCode.NO_ADDRESS_SELECTED);
  }

  // TODO: more proper checking?

  return { success: true, message: '' };
}

function cardanoWalletModeToName(walletMode: WalletMode): string {
  switch (walletMode) {
    case WalletMode.CARDANO_FLINT:
      return 'flint';
    case WalletMode.CARDANO_NUFI:
      return 'nufi';
    case WalletMode.CARDANO_NAMI:
      return 'nami';
    case WalletMode.CARDANO_ETERNL:
      return 'eternl';
    default:
      return '';
  }
}

export async function cardanoLoginWrapper(walletMode: WalletMode): Promise<Result<Wallet>> {
  const errorFxn = buildEndpointErrorFxn('cardanoLoginWrapper');

  const walletName = cardanoWalletModeToName(walletMode);
  if (!walletName) {
    return errorFxn(PaimaMiddlewareErrorCode.CARDANO_WALLET_NOT_INSTALLED);
  }

  if (typeof (window as any).cardano === 'undefined') {
    return errorFxn(
      PaimaMiddlewareErrorCode.CARDANO_WALLET_NOT_INSTALLED,
      undefined,
      FE_ERR_SPECIFIC_WALLET_NOT_INSTALLED
    );
  }

  try {
    await cardanoLoginSpecific(walletName);
  } catch (err) {
    return errorFxn(PaimaMiddlewareErrorCode.CARDANO_LOGIN);
    // TODO: improve error differentiation
  }

  return {
    success: true,
    result: {
      walletAddress: getCardanoAddress(),
    },
  };
}