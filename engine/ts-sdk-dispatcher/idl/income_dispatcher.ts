/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/income_dispatcher.json`.
 */
export type IncomeDispatcher = {
  "address": "5RBTApVVa2JYk2w5WhjxXPseWb4uCDMnBbtGCSVf4b2p",
  "metadata": {
    "name": "incomeDispatcher",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  99,
                  111,
                  109,
                  101,
                  45,
                  100,
                  105,
                  115,
                  112,
                  97,
                  116,
                  99,
                  104,
                  101,
                  114
                ]
              },
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "platformWallet",
          "type": "pubkey"
        },
        {
          "name": "incomeSource",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "updatePlatformWallet",
      "discriminator": [
        76,
        183,
        6,
        58,
        132,
        56,
        171,
        156
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  99,
                  111,
                  109,
                  101,
                  45,
                  100,
                  105,
                  115,
                  112,
                  97,
                  116,
                  99,
                  104,
                  101,
                  114
                ]
              },
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newPlatformWallet",
          "type": "pubkey"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6001,
      "name": "arithmeticOverflow",
      "msg": "An arithmetic operation overflowed"
    },
    {
      "code": 6002,
      "name": "invalidBaseDecimals",
      "msg": "Invalid base decimals"
    },
    {
      "code": 6003,
      "name": "noDistributionRules",
      "msg": "No distribution rules found for market cap"
    },
    {
      "code": 6004,
      "name": "recipientNotFound",
      "msg": "Recipient not found in distribution"
    },
    {
      "code": 6005,
      "name": "invalidShareSum",
      "msg": "Sum of shares in tier must equal 10000 basis points"
    },
    {
      "code": 6006,
      "name": "incomeCalculatorNotSet",
      "msg": "Income calculator not set"
    }
  ],
  "types": [
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "platformWallet",
            "type": "pubkey"
          },
          {
            "name": "incomeSource",
            "type": "pubkey"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "seedRoot",
      "type": "bytes",
      "value": "[105, 110, 99, 111, 109, 101, 45, 100, 105, 115, 112, 97, 116, 99, 104, 101, 114]"
    }
  ]
};
