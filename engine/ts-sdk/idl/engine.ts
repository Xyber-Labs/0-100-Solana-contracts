/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/engine.json`.
 */
export type Engine = {
  "address": "DhKVzFTjzax7MeLEqiEXmEhm6ERSjehYaamqai5oPKZ7",
  "metadata": {
    "name": "engine",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "addClmmLiquidity",
      "discriminator": [
        95,
        43,
        52,
        162,
        180,
        14,
        143,
        59
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState",
          "writable": true
        },
        {
          "name": "launchPreset"
        },
        {
          "name": "lotteryControl",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  116,
                  114,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "baseMint"
        },
        {
          "name": "escrowAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "baseEscrowAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "escrowAuthority"
              },
              {
                "kind": "account",
                "path": "baseTokenProgram"
              },
              {
                "kind": "account",
                "path": "baseMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "quoteEscrowAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "escrowAuthority"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "raydiumAmmConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "const",
                "value": [
                  0,
                  2
                ]
              }
            ],
            "program": {
              "kind": "account",
              "path": "raydiumProgram"
            }
          }
        },
        {
          "name": "raydiumPoolState",
          "writable": true
        },
        {
          "name": "raydiumQuoteVault",
          "writable": true
        },
        {
          "name": "raydiumBaseVault",
          "writable": true
        },
        {
          "name": "raydiumPositionNftMint",
          "writable": true,
          "signer": true
        },
        {
          "name": "raydiumPositionNftAccount",
          "writable": true
        },
        {
          "name": "raydiumPersonalPosition",
          "writable": true
        },
        {
          "name": "raydiumProtocolPosition",
          "writable": true
        },
        {
          "name": "raydiumTickArrayLower",
          "writable": true
        },
        {
          "name": "raydiumTickArrayUpper",
          "writable": true
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "raydiumProgram",
          "address": "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
        },
        {
          "name": "quoteTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "baseTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claim",
      "docs": [
        "Claims tokens from a specified bucket after lottery finalization.",
        "`bucket` specifies which allocation to claim: `Sale` for lottery winners",
        "or `Team` for team allocation. Requires claims to be open.",
        "Delegates to `instructions::claim`."
      ],
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "participant",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState"
        },
        {
          "name": "launchPreset"
        },
        {
          "name": "lotteryControl",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  116,
                  114,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "winnersBitmap",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  110,
                  110,
                  101,
                  114,
                  115,
                  95,
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "inactiveBitmap",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  97,
                  99,
                  116,
                  105,
                  118,
                  101,
                  95,
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "contribution",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  116,
                  114,
                  105,
                  98,
                  117,
                  116,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              },
              {
                "kind": "account",
                "path": "participant"
              }
            ]
          }
        },
        {
          "name": "ticketsClaimed",
          "writable": true
        },
        {
          "name": "baseMint"
        },
        {
          "name": "escrowAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "baseEscrowAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "escrowAuthority"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "baseMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "participantAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "participant"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "baseMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bucket",
          "type": {
            "defined": {
              "name": "bucket"
            }
          }
        }
      ]
    },
    {
      "name": "claimClmmFees",
      "discriminator": [
        224,
        247,
        150,
        26,
        146,
        28,
        145,
        56
      ],
      "accounts": [
        {
          "name": "dispatcherAuthority",
          "signer": true,
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
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                14,
                86,
                241,
                145,
                40,
                148,
                215,
                139,
                118,
                13,
                61,
                172,
                126,
                110,
                141,
                174,
                80,
                63,
                192,
                137,
                114,
                59,
                236,
                99,
                216,
                183,
                139,
                243,
                49,
                8,
                216,
                3
              ]
            }
          }
        },
        {
          "name": "raydiumProgram",
          "address": "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
        },
        {
          "name": "launchState"
        },
        {
          "name": "escrowAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "raydiumPositionNftMint",
          "writable": true
        },
        {
          "name": "raydiumPositionNftAccount",
          "writable": true
        },
        {
          "name": "personalPosition",
          "writable": true
        },
        {
          "name": "poolState",
          "writable": true
        },
        {
          "name": "protocolPosition",
          "writable": true
        },
        {
          "name": "tokenVault0",
          "writable": true
        },
        {
          "name": "tokenVault1",
          "writable": true
        },
        {
          "name": "tickArrayLower",
          "writable": true
        },
        {
          "name": "tickArrayUpper",
          "writable": true
        },
        {
          "name": "recipientTokenAccount0",
          "writable": true
        },
        {
          "name": "recipientTokenAccount1",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "tokenProgram2022",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "memoProgram",
          "address": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        },
        {
          "name": "vault0Mint"
        },
        {
          "name": "vault1Mint"
        }
      ],
      "args": []
    },
    {
      "name": "createClmmPool",
      "discriminator": [
        181,
        223,
        6,
        178,
        60,
        61,
        34,
        9
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState",
          "writable": true
        },
        {
          "name": "launchPreset"
        },
        {
          "name": "lotteryControl",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  116,
                  114,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "escrowAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "baseMint",
          "writable": true,
          "signer": true
        },
        {
          "name": "baseEscrowAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "escrowAuthority"
              },
              {
                "kind": "account",
                "path": "baseTokenProgram"
              },
              {
                "kind": "account",
                "path": "baseMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "quoteMint",
          "address": "So11111111111111111111111111111111111111112"
        },
        {
          "name": "raydiumAmmConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "const",
                "value": [
                  0,
                  2
                ]
              }
            ],
            "program": {
              "kind": "account",
              "path": "raydiumProgram"
            }
          }
        },
        {
          "name": "raydiumPoolState",
          "writable": true
        },
        {
          "name": "raydiumBaseVault",
          "writable": true
        },
        {
          "name": "raydiumQuoteVault",
          "writable": true
        },
        {
          "name": "raydiumObservationState",
          "writable": true
        },
        {
          "name": "raydiumTickArrayBitmap",
          "writable": true
        },
        {
          "name": "raydiumProgram",
          "address": "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
        },
        {
          "name": "quoteTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "baseTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "metadataAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "tokenMetadataProgram"
              },
              {
                "kind": "account",
                "path": "baseMint"
              }
            ],
            "program": {
              "kind": "account",
              "path": "tokenMetadataProgram"
            }
          }
        },
        {
          "name": "tokenMetadataConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "tokenMetadataProgram",
          "address": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        }
      ],
      "args": []
    },
    {
      "name": "deposit",
      "docs": [
        "Deposit lamports (must be multiple of τ); allocate tickets in bitmap; move lamports to escrow."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "contributor",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState",
          "writable": true
        },
        {
          "name": "launchPreset"
        },
        {
          "name": "reallocFunds",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  97,
                  108,
                  108,
                  111,
                  99,
                  95,
                  102,
                  117,
                  110,
                  100,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "lotteryControl",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  116,
                  114,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "winnersBitmap",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  110,
                  110,
                  101,
                  114,
                  115,
                  95,
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "inactiveBitmap",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  97,
                  99,
                  116,
                  105,
                  118,
                  101,
                  95,
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "contribution",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  116,
                  114,
                  105,
                  98,
                  117,
                  116,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              },
              {
                "kind": "account",
                "path": "contributor"
              }
            ]
          }
        },
        {
          "name": "escrowAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "clock",
          "address": "SysvarC1ock11111111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "finalizeLottery",
      "docs": [
        "Finalize lottery - select winners and open claims"
      ],
      "discriminator": [
        154,
        15,
        182,
        158,
        104,
        143,
        220,
        55
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState",
          "writable": true
        },
        {
          "name": "launchPreset"
        },
        {
          "name": "lotteryControl",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  116,
                  114,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "winnersBitmap",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  110,
                  110,
                  101,
                  114,
                  115,
                  95,
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "inactiveBitmap",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  97,
                  99,
                  116,
                  105,
                  118,
                  101,
                  95,
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "getLiquidityRange",
      "discriminator": [
        64,
        75,
        195,
        159,
        13,
        177,
        250,
        1
      ],
      "accounts": [
        {
          "name": "launchState"
        },
        {
          "name": "launchPreset"
        },
        {
          "name": "lotteryControl",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  116,
                  114,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "baseMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "raydiumQuoteVault"
        },
        {
          "name": "raydiumBaseVault"
        },
        {
          "name": "quoteTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "baseTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "raydiumAmmConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "const",
                "value": [
                  0,
                  2
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                184,
                152,
                151,
                52,
                252,
                179,
                140,
                145,
                104,
                216,
                83,
                199,
                83,
                182,
                184,
                164,
                54,
                16,
                205,
                211,
                37,
                175,
                187,
                199,
                47,
                212,
                21,
                54,
                219,
                205,
                194,
                88
              ]
            }
          }
        }
      ],
      "args": [],
      "returns": {
        "defined": {
          "name": "liquidityRange"
        }
      }
    },
    {
      "name": "initEngineConfig",
      "discriminator": [
        184,
        166,
        151,
        83,
        176,
        40,
        10,
        235
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "engineConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
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
          "name": "reallocFunds",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  97,
                  108,
                  108,
                  111,
                  99,
                  95,
                  102,
                  117,
                  110,
                  100,
                  115
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
          "name": "params",
          "type": {
            "defined": {
              "name": "initEngineConfigParams"
            }
          }
        }
      ]
    },
    {
      "name": "initLaunch",
      "discriminator": [
        75,
        162,
        31,
        198,
        192,
        109,
        36,
        169
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "projectCounter",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  106,
                  101,
                  99,
                  116,
                  95,
                  99,
                  111,
                  117,
                  110,
                  116,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "launchState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "arg",
                "path": "projectId"
              }
            ]
          }
        },
        {
          "name": "escrowAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "tokenMetadataConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "engineConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
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
          "name": "creatorXyberAta",
          "writable": true
        },
        {
          "name": "treasuryXyberAta",
          "writable": true
        },
        {
          "name": "launchPreset"
        },
        {
          "name": "lotteryControl",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  116,
                  114,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "winnersBitmap",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  110,
                  110,
                  101,
                  114,
                  115,
                  95,
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "inactiveBitmap",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  97,
                  99,
                  116,
                  105,
                  118,
                  101,
                  95,
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "creatorContribution",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  116,
                  114,
                  105,
                  98,
                  117,
                  116,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              },
              {
                "kind": "account",
                "path": "creator"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "presetId",
          "type": "u8"
        },
        {
          "name": "projectId",
          "type": "u64"
        },
        {
          "name": "saleStartTimeTimestamp",
          "type": "i64"
        },
        {
          "name": "meta",
          "type": {
            "defined": {
              "name": "tokenMetadataInput"
            }
          }
        }
      ]
    },
    {
      "name": "initLaunchPreset",
      "discriminator": [
        219,
        152,
        56,
        254,
        153,
        12,
        96,
        162
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "engineConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
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
          "name": "launchPreset",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u8"
        },
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initLaunchPresetParams"
            }
          }
        }
      ]
    },
    {
      "name": "refund",
      "docs": [
        "Refunds SOL to participants for non-winning lottery tickets.",
        "Requires lottery to be finalized and claims to be open.",
        "Delegates to `instructions::refund`."
      ],
      "discriminator": [
        2,
        96,
        183,
        251,
        63,
        208,
        46,
        46
      ],
      "accounts": [
        {
          "name": "contributor",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState"
        },
        {
          "name": "launchPreset"
        },
        {
          "name": "lotteryControl",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  116,
                  114,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "winnersBitmap",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  110,
                  110,
                  101,
                  114,
                  115,
                  95,
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "inactiveBitmap",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  97,
                  99,
                  116,
                  105,
                  118,
                  101,
                  95,
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "contribution",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  116,
                  114,
                  105,
                  98,
                  117,
                  116,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              },
              {
                "kind": "account",
                "path": "contributor"
              }
            ]
          }
        },
        {
          "name": "escrowAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "setSeed",
      "docs": [
        "Permissionless seed setter using recent blockhash."
      ],
      "discriminator": [
        63,
        37,
        179,
        25,
        135,
        54,
        47,
        119
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState",
          "writable": true
        },
        {
          "name": "launchPreset"
        },
        {
          "name": "lotteryControl",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  116,
                  114,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "clock",
          "address": "SysvarC1ock11111111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "withdraw",
      "docs": [
        "Withdraw during funding window (reduces ticket_count and returns lamports)."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "contributor",
          "writable": true,
          "signer": true
        },
        {
          "name": "contribution",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  116,
                  114,
                  105,
                  98,
                  117,
                  116,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              },
              {
                "kind": "account",
                "path": "contributor"
              }
            ]
          }
        },
        {
          "name": "launchState",
          "writable": true
        },
        {
          "name": "launchPreset"
        },
        {
          "name": "lotteryControl",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  116,
                  116,
                  101,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  116,
                  114,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "winnersBitmap",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  110,
                  110,
                  101,
                  114,
                  115,
                  95,
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "inactiveBitmap",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  97,
                  99,
                  116,
                  105,
                  118,
                  101,
                  95,
                  98,
                  105,
                  116,
                  109,
                  97,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "escrowAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
                  45,
                  48,
                  45,
                  49,
                  48,
                  48,
                  45,
                  49
                ]
              },
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              }
            ]
          }
        },
        {
          "name": "clock",
          "address": "SysvarC1ock11111111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "ammConfig",
      "discriminator": [
        218,
        244,
        33,
        104,
        203,
        203,
        43,
        111
      ]
    },
    {
      "name": "contribution",
      "discriminator": [
        182,
        187,
        14,
        111,
        72,
        167,
        242,
        212
      ]
    },
    {
      "name": "engineConfig",
      "discriminator": [
        10,
        197,
        172,
        236,
        51,
        169,
        22,
        207
      ]
    },
    {
      "name": "launchPreset",
      "discriminator": [
        29,
        197,
        177,
        13,
        230,
        184,
        203,
        69
      ]
    },
    {
      "name": "launchState",
      "discriminator": [
        190,
        149,
        142,
        151,
        19,
        196,
        133,
        100
      ]
    },
    {
      "name": "lotteryControl",
      "discriminator": [
        48,
        249,
        104,
        98,
        175,
        40,
        51,
        86
      ]
    },
    {
      "name": "projectCounter",
      "discriminator": [
        210,
        217,
        66,
        75,
        194,
        9,
        88,
        148
      ]
    },
    {
      "name": "ticketsClaimed",
      "discriminator": [
        176,
        199,
        171,
        255,
        201,
        23,
        12,
        145
      ]
    },
    {
      "name": "tokenMetadataConfig",
      "discriminator": [
        221,
        55,
        116,
        76,
        231,
        177,
        60,
        245
      ]
    }
  ],
  "events": [
    {
      "name": "cancelled",
      "discriminator": [
        136,
        23,
        42,
        65,
        143,
        233,
        234,
        46
      ]
    },
    {
      "name": "claimed",
      "discriminator": [
        217,
        192,
        123,
        72,
        108,
        150,
        248,
        33
      ]
    },
    {
      "name": "deposited",
      "discriminator": [
        111,
        141,
        26,
        45,
        161,
        35,
        100,
        57
      ]
    },
    {
      "name": "finalized",
      "discriminator": [
        4,
        77,
        242,
        80,
        20,
        152,
        247,
        252
      ]
    },
    {
      "name": "initialized",
      "discriminator": [
        208,
        213,
        115,
        98,
        115,
        82,
        201,
        209
      ]
    },
    {
      "name": "refunded",
      "discriminator": [
        35,
        103,
        149,
        246,
        196,
        123,
        221,
        99
      ]
    },
    {
      "name": "seeded",
      "discriminator": [
        95,
        55,
        75,
        113,
        178,
        157,
        251,
        224
      ]
    },
    {
      "name": "withdrawn",
      "discriminator": [
        20,
        89,
        223,
        198,
        194,
        124,
        219,
        13
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "fundingInactive",
      "msg": "Funding is not active"
    },
    {
      "code": 6001,
      "name": "fundingNotEnded",
      "msg": "Funding has not ended yet"
    },
    {
      "code": 6002,
      "name": "claimsNotOpen",
      "msg": "Claims are not open"
    },
    {
      "code": 6003,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6004,
      "name": "badAmount",
      "msg": "Amount must be multiple of tau"
    },
    {
      "code": 6005,
      "name": "depositCapExceeded",
      "msg": "Per-wallet cap exceeded"
    },
    {
      "code": 6006,
      "name": "insufficientDeposit",
      "msg": "Insufficient deposit"
    },
    {
      "code": 6007,
      "name": "limitExceeded",
      "msg": "Limit exceeded"
    },
    {
      "code": 6008,
      "name": "seedMissing",
      "msg": "Seed missing"
    },
    {
      "code": 6009,
      "name": "alreadyFinalized",
      "msg": "Selection already finalized"
    },
    {
      "code": 6010,
      "name": "notFinalized",
      "msg": "Selection not finalized"
    },
    {
      "code": 6011,
      "name": "invalidDivisor",
      "msg": "Divisor must be greater than zero"
    },
    {
      "code": 6012,
      "name": "alreadyRefunded",
      "msg": "Already claimed refund"
    },
    {
      "code": 6013,
      "name": "noRecentBlockhashes",
      "msg": "No recent blockhashes found in SlotHashes sysvar"
    },
    {
      "code": 6014,
      "name": "poolAlreadyCreated",
      "msg": "Pool already created"
    },
    {
      "code": 6015,
      "name": "noValidBlockhash",
      "msg": "No valid blockhash found in recent blocks"
    },
    {
      "code": 6016,
      "name": "invalidSlotHashesData",
      "msg": "Invalid slot hashes data"
    },
    {
      "code": 6017,
      "name": "arithmeticOverflow",
      "msg": "An arithmetic operation overflowed"
    },
    {
      "code": 6018,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    },
    {
      "code": 6019,
      "name": "invalidMint",
      "msg": "Invalid mint for ATA"
    },
    {
      "code": 6020,
      "name": "invalidOwner",
      "msg": "Invalid owner for ATA"
    },
    {
      "code": 6021,
      "name": "invalidAuthority",
      "msg": "Invalid authority"
    },
    {
      "code": 6022,
      "name": "malformedPreset",
      "msg": "Malformed preset"
    },
    {
      "code": 6023,
      "name": "notEnoughAdminSigners",
      "msg": "Not enough admin signatures"
    },
    {
      "code": 6024,
      "name": "invalidAdminThreshold",
      "msg": "Invalid admin threshold"
    },
    {
      "code": 6025,
      "name": "invalidAdminSet",
      "msg": "Invalid admin set"
    },
    {
      "code": 6026,
      "name": "insufficientFeeBalance",
      "msg": "Insufficient fee balance"
    },
    {
      "code": 6027,
      "name": "invalidPrice",
      "msg": "Invalid price: must be finite and positive"
    },
    {
      "code": 6028,
      "name": "priceOverflow",
      "msg": "Price overflow: result exceeds u128::MAX"
    },
    {
      "code": 6029,
      "name": "bitmapFull",
      "msg": "Bitmap is full"
    },
    {
      "code": 6030,
      "name": "invalidAccountDiscriminator",
      "msg": "Invalid account discriminator"
    },
    {
      "code": 6031,
      "name": "invalidParams",
      "msg": "Invalid params"
    }
  ],
  "types": [
    {
      "name": "ammConfig",
      "docs": [
        "Holds the current owner of the factory"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "docs": [
              "Bump to identify PDA"
            ],
            "type": "u8"
          },
          {
            "name": "index",
            "type": "u16"
          },
          {
            "name": "owner",
            "docs": [
              "Address of the protocol owner"
            ],
            "type": "pubkey"
          },
          {
            "name": "protocolFeeRate",
            "docs": [
              "The protocol fee"
            ],
            "type": "u32"
          },
          {
            "name": "tradeFeeRate",
            "docs": [
              "The trade fee, denominated in hundredths of a bip (10^-6)"
            ],
            "type": "u32"
          },
          {
            "name": "tickSpacing",
            "docs": [
              "The tick spacing"
            ],
            "type": "u16"
          },
          {
            "name": "fundFeeRate",
            "docs": [
              "The fund fee, denominated in hundredths of a bip (10^-6)"
            ],
            "type": "u32"
          },
          {
            "name": "paddingU32",
            "type": "u32"
          },
          {
            "name": "fundOwner",
            "type": "pubkey"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u64",
                3
              ]
            }
          }
        ]
      }
    },
    {
      "name": "bucket",
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "sale"
          },
          {
            "name": "team"
          }
        ]
      }
    },
    {
      "name": "cancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "minRaise",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "claimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "participant",
            "type": "pubkey"
          },
          {
            "name": "bucket",
            "type": "u8"
          },
          {
            "name": "tokens",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "contribution",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ticketsRefunded",
            "type": "u64"
          },
          {
            "name": "withdrawCount",
            "type": "u8"
          },
          {
            "name": "ticketRanges",
            "type": {
              "vec": {
                "defined": {
                  "name": "ticketRange"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "deposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "contributor",
            "type": "pubkey"
          },
          {
            "name": "lamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "engineConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "xyberMint",
            "type": "pubkey"
          },
          {
            "name": "admins",
            "type": {
              "array": [
                "pubkey",
                3
              ]
            }
          },
          {
            "name": "threshold",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "finalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "kCapacity",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "initEngineConfigParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "xyberMint",
            "type": "pubkey"
          },
          {
            "name": "admins",
            "type": {
              "array": [
                "pubkey",
                3
              ]
            }
          },
          {
            "name": "threshold",
            "type": "u8"
          },
          {
            "name": "reallocFundLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "initLaunchPresetParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hardCapLamports",
            "type": "u64"
          },
          {
            "name": "minRaiseLamports",
            "type": "u64"
          },
          {
            "name": "perWalletCap",
            "type": "u64"
          },
          {
            "name": "tauLamports",
            "type": "u64"
          },
          {
            "name": "baseTotalAllocation",
            "type": "u64"
          },
          {
            "name": "baseSaleBasisPoints",
            "type": "u64"
          },
          {
            "name": "teamAllocationBasisPoints",
            "type": "u64"
          },
          {
            "name": "fundingDurationSeconds",
            "type": "i64"
          },
          {
            "name": "unlockTimeSec",
            "type": "i64"
          },
          {
            "name": "creatorPeriodUnlock",
            "type": "u64"
          },
          {
            "name": "creatorPeriodSec",
            "type": "i64"
          },
          {
            "name": "creatorMaxDeposit",
            "type": "u64"
          },
          {
            "name": "poolCreationGracePeriodSec",
            "type": "i64"
          },
          {
            "name": "teamDurationSec",
            "type": "i64"
          },
          {
            "name": "teamPeriodSec",
            "type": "i64"
          },
          {
            "name": "contributorDurationSec",
            "type": "i64"
          },
          {
            "name": "contributorPeriodSec",
            "type": "i64"
          },
          {
            "name": "withdrawalLimit",
            "type": "u8"
          },
          {
            "name": "creationFee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "initialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "projectId",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "presetId",
            "type": "u8"
          },
          {
            "name": "fundingStart",
            "type": "i64"
          },
          {
            "name": "pendingKey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "launchPreset",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u8"
          },
          {
            "name": "hardCapLamports",
            "type": "u64"
          },
          {
            "name": "minRaiseLamports",
            "type": "u64"
          },
          {
            "name": "perWalletCap",
            "type": "u64"
          },
          {
            "name": "tauLamports",
            "type": "u64"
          },
          {
            "name": "baseTotalAllocation",
            "type": "u64"
          },
          {
            "name": "baseSaleBasisPoints",
            "type": "u64"
          },
          {
            "name": "teamAllocationBasisPoints",
            "type": "u64"
          },
          {
            "name": "fundingDurationSeconds",
            "type": "i64"
          },
          {
            "name": "unlockTimeSec",
            "type": "i64"
          },
          {
            "name": "creatorPeriodUnlock",
            "type": "u64"
          },
          {
            "name": "creatorPeriodSec",
            "type": "i64"
          },
          {
            "name": "creatorMaxDeposit",
            "type": "u64"
          },
          {
            "name": "poolCreationGracePeriodSec",
            "type": "i64"
          },
          {
            "name": "teamDurationSec",
            "type": "i64"
          },
          {
            "name": "teamPeriodSec",
            "type": "i64"
          },
          {
            "name": "contributorDurationSec",
            "type": "i64"
          },
          {
            "name": "contributorPeriodSec",
            "type": "i64"
          },
          {
            "name": "withdrawalLimit",
            "type": "u8"
          },
          {
            "name": "creationFee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "launchState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "createdAt",
            "docs": [
              "Unix timestamp (seconds) when the launch was created"
            ],
            "type": "i64"
          },
          {
            "name": "projectId",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "preset",
            "type": "pubkey"
          },
          {
            "name": "baseMint",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "fundingStart",
            "type": "i64"
          },
          {
            "name": "raydiumPoolState",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "raydiumPositionNftMint",
            "type": {
              "option": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "liquidityRange",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tickArrayLower",
            "type": "i32"
          },
          {
            "name": "tickArrayLowerStartIndex",
            "type": "i32"
          },
          {
            "name": "tickArrayUpper",
            "type": "i32"
          },
          {
            "name": "tickArrayUpperStartIndex",
            "type": "i32"
          }
        ]
      }
    },
    {
      "name": "lotteryControl",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bitsAllocated",
            "type": "u64"
          },
          {
            "name": "inactiveCount",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "lotteryStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "lotteryStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "funding"
          },
          {
            "name": "seeded",
            "fields": [
              {
                "name": "seed",
                "type": {
                  "array": [
                    "u8",
                    32
                  ]
                }
              }
            ]
          },
          {
            "name": "finalized",
            "fields": [
              {
                "name": "tokensPerTicket",
                "type": "u64"
              },
              {
                "name": "claimsOpenedAt",
                "type": "i64"
              }
            ]
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "projectCounter",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lastProjectId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "refunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "contributor",
            "type": "pubkey"
          },
          {
            "name": "lamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "seeded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "seedHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "ticketRange",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "start",
            "type": "u64"
          },
          {
            "name": "end",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ticketsClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "value",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tokenMetadataConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "isMutable",
            "type": "bool"
          },
          {
            "name": "sellerFeeBasisPoints",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "tokenMetadataInput",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "isMutable",
            "type": "bool"
          },
          {
            "name": "sellerFeeBasisPoints",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "withdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "contributor",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "ammConfigIndex",
      "type": "u16",
      "value": "2"
    },
    {
      "name": "baseTokenDecimals",
      "type": "u8",
      "value": "9"
    },
    {
      "name": "dispatcherSeedRoot",
      "type": "bytes",
      "value": "[105, 110, 99, 111, 109, 101, 45, 100, 105, 115, 112, 97, 116, 99, 104, 101, 114]"
    },
    {
      "name": "incomeDispatcherProgramId",
      "type": "pubkey",
      "value": "xybsGBqV6ZMx3aDoriQxHKU2dzR7kLAtR2ACA87216z"
    },
    {
      "name": "raydiumClmmProgramId",
      "type": "pubkey",
      "value": "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
    },
    {
      "name": "seedRoot",
      "type": "bytes",
      "value": "[114, 111, 111, 116, 45, 48, 45, 49, 48, 48, 45, 49]"
    },
    {
      "name": "teamBasisPoints",
      "type": "u64",
      "value": "1000"
    },
    {
      "name": "teamClaimMinIntervalSec",
      "type": "i64",
      "value": "1"
    },
    {
      "name": "teamVestingDurationSec",
      "type": "i64",
      "value": "31536000"
    }
  ]
};
