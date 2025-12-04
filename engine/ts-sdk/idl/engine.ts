/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/engine.json`.
 */
export type Engine = {
  "address": "xybbtDz3bo6zgUHEnM8sgX7ZeftDhdRi1Hw8tBncu3p",
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
                  4
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
          "name": "poolState",
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
                  111,
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
          "address": "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"
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
          "name": "projectAuthority",
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
                  112,
                  114,
                  111,
                  106,
                  101,
                  99,
                  116,
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
                "path": "launch_state.project_id",
                "account": "launchState"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                14,
                86,
                238,
                250,
                96,
                59,
                185,
                36,
                107,
                71,
                201,
                136,
                1,
                190,
                45,
                72,
                224,
                49,
                210,
                122,
                196,
                162,
                164,
                169,
                20,
                224,
                81,
                151,
                62,
                95,
                245,
                51
              ]
            }
          }
        },
        {
          "name": "raydiumProgram",
          "address": "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"
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
      "name": "claimCreatorRefund",
      "docs": [
        "Claim creator refund for failed launches"
      ],
      "discriminator": [
        168,
        92,
        198,
        50,
        65,
        220,
        247,
        185
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState"
        },
        {
          "name": "creatorGrant",
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
                  114,
                  101,
                  97,
                  116,
                  111,
                  114
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claimCreatorTokens",
      "docs": [
        "Claim creator tokens with daily limits"
      ],
      "discriminator": [
        126,
        208,
        113,
        43,
        222,
        70,
        91,
        48
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState"
        },
        {
          "name": "poolState",
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
                  111,
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
          "name": "creatorGrant",
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
                  114,
                  101,
                  97,
                  116,
                  111,
                  114
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
          "name": "creatorAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "claimRefund",
      "docs": [
        "Claim refund after selection finalized: recompute y_i and pay back (deposited - y_i*τ)."
      ],
      "discriminator": [
        15,
        16,
        30,
        161,
        255,
        228,
        97,
        60
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState"
        },
        {
          "name": "userContribution",
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
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "rosterShard",
          "writable": true,
          "optional": true
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
      "name": "claimTeamTokens",
      "discriminator": [
        137,
        104,
        44,
        247,
        225,
        216,
        99,
        11
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState"
        },
        {
          "name": "poolState",
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
                  111,
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
          "name": "teamVesting",
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
                  101,
                  97,
                  109
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
                "path": "tokenProgram"
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
          "name": "creatorAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "claimTokens",
      "docs": [
        "Claim tokens (post open_claims): mint tokens_per_ticket * y_i to user ATA."
      ],
      "discriminator": [
        108,
        216,
        210,
        231,
        0,
        212,
        42,
        64
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState"
        },
        {
          "name": "userContribution",
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
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "rosterShard",
          "writable": true,
          "optional": true
        },
        {
          "name": "poolState",
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
                  111,
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
          "name": "userAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "closeRosterShard",
      "docs": [
        "Close roster shard account after sealing"
      ],
      "discriminator": [
        87,
        131,
        169,
        146,
        4,
        168,
        88,
        103
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
          "name": "rosterShard",
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
                  111,
                  115,
                  116,
                  101,
                  114,
                  95,
                  115,
                  104,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              },
              {
                "kind": "arg",
                "path": "shardId"
              }
            ]
          }
        },
        {
          "name": "refundTo",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "shardId",
          "type": "u16"
        }
      ]
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
          "name": "poolState",
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
                  111,
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
                  4
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
          "address": "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"
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
      "name": "creatorDeposit",
      "docs": [
        "Creator can increase special deposit during funding window"
      ],
      "discriminator": [
        214,
        153,
        77,
        240,
        195,
        20,
        138,
        159
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "launchState"
          ]
        },
        {
          "name": "launchState",
          "writable": true
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
          "name": "creatorGrant",
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
                  114,
                  101,
                  97,
                  116,
                  111,
                  114
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
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "creatorWithdraw",
      "docs": [
        "Creator can decrease special deposit during funding window"
      ],
      "discriminator": [
        92,
        117,
        206,
        254,
        174,
        108,
        37,
        106
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "launchState"
          ]
        },
        {
          "name": "launchState",
          "writable": true
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
          "name": "creatorGrant",
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
                  114,
                  101,
                  97,
                  116,
                  111,
                  114
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
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "Deposit lamports (must be multiple of τ); update user + roster; move lamports to escrow."
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
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState",
          "writable": true
        },
        {
          "name": "userContribution",
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
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "rosterShard",
          "writable": true
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
          "name": "launch"
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
      "name": "finalizeRosterShard",
      "docs": [
        "Finalize roster shard (compute prefix, set shard_base, bump totals)"
      ],
      "discriminator": [
        124,
        151,
        200,
        25,
        61,
        233,
        114,
        255
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
          "name": "rosterShard",
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
                  111,
                  115,
                  116,
                  101,
                  114,
                  95,
                  115,
                  104,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              },
              {
                "kind": "arg",
                "path": "shardId"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "shardId",
          "type": "u16"
        }
      ]
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
                  4
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                165,
                213,
                202,
                158,
                4,
                207,
                93,
                181,
                144,
                183,
                20,
                186,
                47,
                227,
                44,
                177,
                89,
                19,
                63,
                193,
                193,
                146,
                183,
                34,
                87,
                253,
                7,
                211,
                156,
                176,
                64,
                30
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
      "docs": [
        "Create launch + PDAs (escrow, mint authority PDA is derived, not stored)."
      ],
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
          "docs": [
            "Global project counter"
          ],
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
          "name": "creatorGrant",
          "docs": [
            "Creator grant account (PDA off launch_state)"
          ],
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
                  114,
                  101,
                  97,
                  116,
                  111,
                  114
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
          "name": "params",
          "type": {
            "defined": {
              "name": "initLaunchParams"
            }
          }
        },
        {
          "name": "projectId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initLaunchFromPreset",
      "discriminator": [
        134,
        182,
        130,
        54,
        214,
        93,
        249,
        175
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
          "name": "creatorGrant",
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
                  114,
                  101,
                  97,
                  116,
                  111,
                  114
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
      "name": "initRosterShard",
      "docs": [
        "Initialize roster shard account"
      ],
      "discriminator": [
        251,
        25,
        110,
        80,
        137,
        49,
        197,
        88
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
          "name": "rosterShard",
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
                  111,
                  115,
                  116,
                  101,
                  114,
                  95,
                  115,
                  104,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              },
              {
                "kind": "arg",
                "path": "shardId"
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
          "name": "shardId",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initTeamVesting",
      "discriminator": [
        223,
        100,
        145,
        80,
        168,
        121,
        82,
        164
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
          "name": "teamVesting",
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
                  101,
                  97,
                  109
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
      "name": "preparePoolCreation",
      "docs": [
        "Create AMM pool"
      ],
      "discriminator": [
        38,
        193,
        253,
        218,
        109,
        225,
        56,
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
          "name": "creatorGrant",
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
                  114,
                  101,
                  97,
                  116,
                  111,
                  114
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
          "name": "poolState",
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
                  111,
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "sealRosterShard",
      "docs": [
        "Seal roster shard by snapshotting user ticket ranges into UserContribution"
      ],
      "discriminator": [
        18,
        100,
        12,
        188,
        84,
        188,
        103,
        13
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "launchState",
          "writable": true
        },
        {
          "name": "rosterShard",
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
                  111,
                  115,
                  116,
                  101,
                  114,
                  95,
                  115,
                  104,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              },
              {
                "kind": "arg",
                "path": "shardId"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "shardId",
          "type": "u16"
        },
        {
          "name": "from",
          "type": "u32"
        },
        {
          "name": "max",
          "type": "u16"
        }
      ]
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
      "name": "updateEngineConfig",
      "discriminator": [
        62,
        159,
        32,
        233,
        137,
        163,
        225,
        42
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
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "updateEngineConfigParams"
            }
          }
        }
      ]
    },
    {
      "name": "updateLaunchPreset",
      "discriminator": [
        137,
        161,
        39,
        168,
        45,
        186,
        69,
        79
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
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u8"
        },
        {
          "name": "patch",
          "type": {
            "defined": {
              "name": "updateLaunchParams"
            }
          }
        }
      ]
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
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState",
          "writable": true
        },
        {
          "name": "userContribution",
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
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "launchState"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "rosterShard",
          "writable": true
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
          "name": "launch"
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
      "name": "creatorGrant",
      "discriminator": [
        80,
        101,
        45,
        193,
        223,
        50,
        10,
        157
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
      "name": "poolState",
      "discriminator": [
        247,
        237,
        227,
        245,
        215,
        195,
        222,
        70
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
      "name": "rosterShard",
      "discriminator": [
        31,
        213,
        128,
        164,
        233,
        238,
        137,
        178
      ]
    },
    {
      "name": "teamVesting",
      "discriminator": [
        111,
        31,
        119,
        194,
        134,
        31,
        241,
        1
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
    },
    {
      "name": "userContribution",
      "discriminator": [
        89,
        250,
        199,
        201,
        234,
        203,
        119,
        235
      ]
    }
  ],
  "events": [
    {
      "name": "batchProcessed",
      "discriminator": [
        199,
        28,
        80,
        191,
        111,
        11,
        127,
        180
      ]
    },
    {
      "name": "claimsOpened",
      "discriminator": [
        126,
        92,
        24,
        148,
        242,
        66,
        8,
        28
      ]
    },
    {
      "name": "creatorClaimed",
      "discriminator": [
        118,
        206,
        30,
        219,
        62,
        164,
        54,
        200
      ]
    },
    {
      "name": "creatorDepositChanged",
      "discriminator": [
        103,
        171,
        3,
        222,
        255,
        235,
        37,
        104
      ]
    },
    {
      "name": "creatorGranted",
      "discriminator": [
        139,
        253,
        204,
        61,
        77,
        195,
        247,
        170
      ]
    },
    {
      "name": "depositMade",
      "discriminator": [
        210,
        201,
        130,
        183,
        244,
        203,
        155,
        199
      ]
    },
    {
      "name": "fundingPeriodStarted",
      "discriminator": [
        24,
        17,
        247,
        144,
        200,
        76,
        119,
        198
      ]
    },
    {
      "name": "fundingScheduleSet",
      "discriminator": [
        250,
        45,
        8,
        244,
        214,
        71,
        244,
        171
      ]
    },
    {
      "name": "launchInitialized",
      "discriminator": [
        60,
        143,
        196,
        55,
        214,
        166,
        10,
        63
      ]
    },
    {
      "name": "poolCreated",
      "discriminator": [
        202,
        44,
        41,
        88,
        104,
        220,
        157,
        82
      ]
    },
    {
      "name": "refundClaimed",
      "discriminator": [
        136,
        64,
        242,
        99,
        4,
        244,
        208,
        130
      ]
    },
    {
      "name": "rosterInitialized",
      "discriminator": [
        111,
        28,
        99,
        210,
        82,
        158,
        188,
        249
      ]
    },
    {
      "name": "rosterShardFinalized",
      "discriminator": [
        136,
        212,
        55,
        122,
        118,
        122,
        150,
        85
      ]
    },
    {
      "name": "rosterShardFull",
      "discriminator": [
        188,
        123,
        134,
        176,
        96,
        36,
        251,
        182
      ]
    },
    {
      "name": "rosterShardInitialized",
      "discriminator": [
        110,
        2,
        21,
        250,
        126,
        114,
        61,
        90
      ]
    },
    {
      "name": "rosterShardNearFull",
      "discriminator": [
        5,
        204,
        207,
        21,
        163,
        159,
        216,
        110
      ]
    },
    {
      "name": "seedSet",
      "discriminator": [
        9,
        179,
        143,
        172,
        250,
        146,
        42,
        6
      ]
    },
    {
      "name": "selectionFinalized",
      "discriminator": [
        111,
        84,
        253,
        234,
        76,
        136,
        103,
        185
      ]
    },
    {
      "name": "teamClaimed",
      "discriminator": [
        142,
        240,
        28,
        70,
        7,
        206,
        152,
        180
      ]
    },
    {
      "name": "teamVestingInitialized",
      "discriminator": [
        77,
        238,
        181,
        180,
        87,
        241,
        148,
        31
      ]
    },
    {
      "name": "tokensClaimed",
      "discriminator": [
        25,
        128,
        244,
        55,
        241,
        136,
        200,
        91
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
      "name": "minRaiseNotMet",
      "msg": "Minimum raise not met"
    },
    {
      "code": 6001,
      "name": "fundingPeriodEnded",
      "msg": "Funding period has ended"
    },
    {
      "code": 6002,
      "name": "fundingPeriodNotStarted",
      "msg": "Funding period has not started yet"
    },
    {
      "code": 6003,
      "name": "fundingPeriodNotEnded",
      "msg": "Funding period has not ended yet"
    },
    {
      "code": 6004,
      "name": "invalidFundingDuration",
      "msg": "Invalid funding duration (must be 0-5, where 0 = 10 seconds for testing)"
    },
    {
      "code": 6005,
      "name": "invalidStartTime",
      "msg": "Invalid start time"
    },
    {
      "code": 6006,
      "name": "claimsNotOpen",
      "msg": "Claims are not open"
    },
    {
      "code": 6007,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6008,
      "name": "amountNotMultipleTau",
      "msg": "Amount must be multiple of tau"
    },
    {
      "code": 6009,
      "name": "perWalletCapExceeded",
      "msg": "Per-wallet cap exceeded"
    },
    {
      "code": 6010,
      "name": "insufficientDeposit",
      "msg": "Insufficient deposit"
    },
    {
      "code": 6011,
      "name": "seedAlreadySet",
      "msg": "Seed already set"
    },
    {
      "code": 6012,
      "name": "seedMissing",
      "msg": "Seed missing"
    },
    {
      "code": 6013,
      "name": "alreadyFinalized",
      "msg": "Selection already finalized"
    },
    {
      "code": 6014,
      "name": "notFinalized",
      "msg": "Selection not finalized"
    },
    {
      "code": 6015,
      "name": "thresholdMissing",
      "msg": "Threshold missing"
    },
    {
      "code": 6016,
      "name": "tokensPerTicketMissing",
      "msg": "Tokens per ticket missing"
    },
    {
      "code": 6017,
      "name": "invalidTau",
      "msg": "Invalid tau"
    },
    {
      "code": 6018,
      "name": "invalidK",
      "msg": "Invalid K"
    },
    {
      "code": 6019,
      "name": "invalidDivisor",
      "msg": "Divisor must be greater than zero"
    },
    {
      "code": 6020,
      "name": "heapNotFull",
      "msg": "Heap not full"
    },
    {
      "code": 6021,
      "name": "userNotFoundInRoster",
      "msg": "User not found in roster"
    },
    {
      "code": 6022,
      "name": "tOutOfRange",
      "msg": "t out of range"
    },
    {
      "code": 6023,
      "name": "mappingError",
      "msg": "Mapping error"
    },
    {
      "code": 6024,
      "name": "alreadyClaimedRefund",
      "msg": "Already claimed refund"
    },
    {
      "code": 6025,
      "name": "alreadyClaimedTokens",
      "msg": "Already claimed tokens"
    },
    {
      "code": 6026,
      "name": "noRecentBlockhashes",
      "msg": "No recent blockhashes found in SlotHashes sysvar"
    },
    {
      "code": 6027,
      "name": "poolAlreadyCreated",
      "msg": "Pool already created"
    },
    {
      "code": 6028,
      "name": "noValidBlockhash",
      "msg": "No valid blockhash found in recent blocks"
    },
    {
      "code": 6029,
      "name": "invalidNumPartitions",
      "msg": "Invalid N value for hash range calculation (must be between MIN_N and MAX_N)"
    },
    {
      "code": 6030,
      "name": "invalidSlotHashesData",
      "msg": "Invalid slot hashes data"
    },
    {
      "code": 6031,
      "name": "rosterFull",
      "msg": "Roster is full"
    },
    {
      "code": 6032,
      "name": "heapCapacityExceeded",
      "msg": "Heap capacity exceeded"
    },
    {
      "code": 6033,
      "name": "mintAlreadyExists",
      "msg": "Mint already exists"
    },
    {
      "code": 6034,
      "name": "arithmeticOverflow",
      "msg": "An arithmetic operation overflowed"
    },
    {
      "code": 6035,
      "name": "u64ConversionOverflow",
      "msg": "u64 to u32 conversion overflow"
    },
    {
      "code": 6036,
      "name": "reservedExceedsCapacity",
      "msg": "Creator reserved tickets exceed capacity"
    },
    {
      "code": 6037,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    },
    {
      "code": 6038,
      "name": "invalidCreatorDeposit",
      "msg": "Creator initial deposit must be multiple of tau"
    },
    {
      "code": 6039,
      "name": "creatorRefundAlreadyClaimed",
      "msg": "Creator refund already claimed"
    },
    {
      "code": 6040,
      "name": "invalidMint",
      "msg": "Invalid mint for ATA"
    },
    {
      "code": 6041,
      "name": "invalidOwner",
      "msg": "Invalid owner for ATA"
    },
    {
      "code": 6042,
      "name": "invalidAuthority",
      "msg": "Invalid authority"
    },
    {
      "code": 6043,
      "name": "invalidHardCap",
      "msg": "Hard cap must be > 0"
    },
    {
      "code": 6044,
      "name": "invalidMinRaise",
      "msg": "Min raise must be > 0"
    },
    {
      "code": 6045,
      "name": "hardCapNotDivisibleByTau",
      "msg": "Hard cap must be divisible by tau"
    },
    {
      "code": 6046,
      "name": "perWalletCapTooSmall",
      "msg": "Per-wallet cap must be >= tau"
    },
    {
      "code": 6047,
      "name": "malformedPreset",
      "msg": "Malformed preset"
    },
    {
      "code": 6048,
      "name": "invalidClaimLockPeriod",
      "msg": "Creator claim lock period must be > 0"
    },
    {
      "code": 6049,
      "name": "invalidCreatorDailyLimit",
      "msg": "Creator daily lamports limit must be >= tau"
    },
    {
      "code": 6050,
      "name": "notSupported",
      "msg": "Operation not supported in current version"
    },
    {
      "code": 6051,
      "name": "rosterShardFull",
      "msg": "Roster shard is full"
    },
    {
      "code": 6052,
      "name": "invalidFinalizeOrder",
      "msg": "Roster finalization order violated"
    },
    {
      "code": 6053,
      "name": "shardNotFinalized",
      "msg": "Roster shard not finalized"
    },
    {
      "code": 6054,
      "name": "shardsNotFullyFinalized",
      "msg": "Claims cannot be opened before all shards finalized"
    },
    {
      "code": 6055,
      "name": "shardIdOutOfRange",
      "msg": "Roster shard id is out of allowed range"
    },
    {
      "code": 6056,
      "name": "noTokensToClaim",
      "msg": "User has no tokens to claim"
    },
    {
      "code": 6057,
      "name": "noDistributionRules",
      "msg": "No distribution rules found for market cap"
    },
    {
      "code": 6058,
      "name": "recipientNotFound",
      "msg": "Recipient not found in distribution"
    },
    {
      "code": 6059,
      "name": "invalidShareSum",
      "msg": "Sum of shares in tier must equal 10000 basis points"
    },
    {
      "code": 6060,
      "name": "invalidBaseDecimals",
      "msg": "Base token decimals must be less than 18"
    },
    {
      "code": 6061,
      "name": "poolNotCreated",
      "msg": "Pool not created yet"
    },
    {
      "code": 6062,
      "name": "teamVestingMissing",
      "msg": "Team vesting account is missing"
    },
    {
      "code": 6063,
      "name": "teamVestingNotStarted",
      "msg": "Team vesting is not started yet"
    },
    {
      "code": 6064,
      "name": "teamClaimsNotOpen",
      "msg": "Team claims are not open yet"
    },
    {
      "code": 6065,
      "name": "teamClaimTooFrequent",
      "msg": "Claim is too frequent"
    },
    {
      "code": 6066,
      "name": "notEnoughAdminSigners",
      "msg": "Not enough admin signatures"
    },
    {
      "code": 6067,
      "name": "invalidAdminThreshold",
      "msg": "Invalid admin threshold"
    },
    {
      "code": 6068,
      "name": "invalidAdminSet",
      "msg": "Invalid admin set"
    },
    {
      "code": 6069,
      "name": "insufficientFeeBalance",
      "msg": "Insufficient fee balance"
    },
    {
      "code": 6070,
      "name": "invalidPrice",
      "msg": "Invalid price: must be finite and positive"
    },
    {
      "code": 6071,
      "name": "priceOverflow",
      "msg": "Price overflow: result exceeds u128::MAX"
    },
    {
      "code": 6072,
      "name": "invalidInitOrder",
      "msg": "Roster initialization order violated"
    },
    {
      "code": 6073,
      "name": "shardNotSealed",
      "msg": "Roster shard not fully sealed"
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
      "name": "batchProcessed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "fromT",
            "type": "u32"
          },
          {
            "name": "processed",
            "type": "u32"
          },
          {
            "name": "heapLen",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "claimsOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "openedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "creatorClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "ticketsClaimed",
            "type": "u32"
          },
          {
            "name": "lamportsEquiv",
            "type": "u64"
          },
          {
            "name": "tokensMinted",
            "type": "u64"
          },
          {
            "name": "dayIndex",
            "type": "i64"
          },
          {
            "name": "remainingTickets",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "creatorDepositChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "deltaLamports",
            "type": "i64"
          },
          {
            "name": "newLockedLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "creatorGrant",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "lockedLamports",
            "type": "u64"
          },
          {
            "name": "reservedTickets",
            "type": "u32"
          },
          {
            "name": "dailyLamportsLimit",
            "type": "u64"
          },
          {
            "name": "dailyTicketCap",
            "type": "u32"
          },
          {
            "name": "claimedTickets",
            "type": "u32"
          },
          {
            "name": "refunded",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "creatorGranted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "lockedLamports",
            "type": "u64"
          },
          {
            "name": "reservedTickets",
            "type": "u32"
          },
          {
            "name": "dailyLamportsLimit",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "depositMade",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "ticketsBefore",
            "type": "u32"
          },
          {
            "name": "ticketsAfter",
            "type": "u32"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "totalTickets",
            "type": "u32"
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
            "name": "creationFee",
            "type": "u64"
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
      "name": "fundingPeriodStarted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "fundingPeriodEnd",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "fundingScheduleSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "fundingPeriodStart",
            "type": "i64"
          },
          {
            "name": "fundingPeriodEnd",
            "type": "i64"
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
            "name": "creationFee",
            "type": "u64"
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
      "name": "initLaunchParams",
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
            "name": "saleStartTimeTimestamp",
            "docs": [
              "Absolute unix timestamp (seconds) when the sale starts.",
              "If 0, the current time will be used."
            ],
            "type": "i64"
          },
          {
            "name": "unlockTimeSec",
            "type": "i64"
          },
          {
            "name": "rosterShardCap",
            "type": "u16"
          },
          {
            "name": "rosterShardsTotal",
            "type": "u16"
          },
          {
            "name": "creatorInitialDepositLamports",
            "type": "u64"
          },
          {
            "name": "creatorDailyLamportsLimit",
            "type": "u64"
          },
          {
            "name": "creatorClaimLockPeriodSec",
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
            "name": "teamVestingDurationSec",
            "type": "i64"
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
            "name": "rosterShardCap",
            "type": "u16"
          },
          {
            "name": "rosterShardsTotal",
            "type": "u16"
          },
          {
            "name": "creatorInitialDepositLamports",
            "type": "u64"
          },
          {
            "name": "creatorDailyLamportsLimit",
            "type": "u64"
          },
          {
            "name": "creatorClaimLockPeriodSec",
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
            "name": "teamVestingDurationSec",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "launchInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "projectId",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "creatorMaxDeposit",
            "type": "u64"
          },
          {
            "name": "creatorInitialDepositLamports",
            "type": "u64"
          },
          {
            "name": "baseMint",
            "type": "pubkey"
          },
          {
            "name": "pendingKey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
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
            "name": "unlockTimeSec",
            "type": "i64"
          },
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "fundingPeriodStart",
            "type": "i64"
          },
          {
            "name": "fundingPeriodEnd",
            "type": "i64"
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
            "name": "rosterShardCap",
            "type": "u16"
          },
          {
            "name": "rosterShardsTotal",
            "type": "u16"
          },
          {
            "name": "creatorInitialDepositLamports",
            "type": "u64"
          },
          {
            "name": "creatorDailyLamportsLimit",
            "type": "u64"
          },
          {
            "name": "creatorClaimLockPeriodSec",
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
            "name": "teamVestingDurationSec",
            "type": "i64"
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
            "name": "projectId",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "pubkey"
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
            "name": "unlockTimeSec",
            "type": "i64"
          },
          {
            "name": "baseMint",
            "type": {
              "option": "pubkey"
            }
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
            "name": "fundingPeriodEnd",
            "type": "i64"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "totalTickets",
            "type": "u32"
          },
          {
            "name": "kCapacity",
            "type": "u32"
          },
          {
            "name": "vrfSeed",
            "type": {
              "option": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "selectionProcessed",
            "type": "u32"
          },
          {
            "name": "selectionFinalized",
            "type": "bool"
          },
          {
            "name": "thresholdScore",
            "type": {
              "option": "u128"
            }
          },
          {
            "name": "rosterShards",
            "type": "u16"
          },
          {
            "name": "rosterInitializedUpTo",
            "type": "i32"
          },
          {
            "name": "rosterFinalizedUpTo",
            "type": "i32"
          },
          {
            "name": "publicTotalTickets",
            "type": "u32"
          },
          {
            "name": "rosterShardCap",
            "type": "u16"
          },
          {
            "name": "rosterHighestUsedShard",
            "type": "u16"
          },
          {
            "name": "tokensPerTicket",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "creatorReservedTickets",
            "type": "u32"
          },
          {
            "name": "creatorGrantPresent",
            "type": "bool"
          },
          {
            "name": "claimsOpenedAt",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "creatorClaimLockPeriodSec",
            "type": "i64"
          },
          {
            "name": "creatorInitialDeposit",
            "type": "u64"
          },
          {
            "name": "creatorMaxDeposit",
            "type": "u64"
          },
          {
            "name": "fundingPeriodStart",
            "type": "i64"
          },
          {
            "name": "poolCreationGracePeriodSec",
            "type": "i64"
          },
          {
            "name": "teamAllocationBasisPoints",
            "type": "u64"
          },
          {
            "name": "teamVestingDurationSec",
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
      "name": "poolCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "poolId",
            "type": "u64"
          },
          {
            "name": "projectId",
            "type": "u64"
          },
          {
            "name": "blockhash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "poolState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "poolId",
            "type": "u64"
          },
          {
            "name": "projectId",
            "type": "u64"
          },
          {
            "name": "createdSlot",
            "type": "u64"
          },
          {
            "name": "createdBlockhash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "created",
            "type": "bool"
          },
          {
            "name": "claimsReady",
            "type": "bool"
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
      "name": "refundClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "refundedLamports",
            "type": "u64"
          },
          {
            "name": "yApproved",
            "docs": [
              "Number of tickets that were approved for token allocation.",
              "If the min raise was not met, this will be 0."
            ],
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "rosterInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "rosterShard",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "shardId",
            "type": "u16"
          },
          {
            "name": "createdBy",
            "type": "pubkey"
          },
          {
            "name": "wallets",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "counts",
            "type": {
              "vec": "u32"
            }
          },
          {
            "name": "prefix",
            "type": {
              "vec": "u32"
            }
          },
          {
            "name": "totalInShard",
            "type": "u32"
          },
          {
            "name": "shardBase",
            "type": "u32"
          },
          {
            "name": "sealedCount",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "rosterShardFinalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "shardId",
            "type": "u16"
          },
          {
            "name": "totalInShard",
            "type": "u32"
          },
          {
            "name": "shardBase",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "rosterShardFull",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "shardId",
            "type": "u16"
          },
          {
            "name": "cap",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "rosterShardInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "shardId",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "rosterShardNearFull",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "shardId",
            "type": "u16"
          },
          {
            "name": "used",
            "type": "u16"
          },
          {
            "name": "cap",
            "type": "u16"
          },
          {
            "name": "thresholdPercent",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "seedSet",
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
      "name": "selectionFinalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "kCapacity",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "teamClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "claimedTotal",
            "type": "u64"
          },
          {
            "name": "remaining",
            "type": "u64"
          },
          {
            "name": "at",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "teamVesting",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "totalAllocation",
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "u64"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "durationSec",
            "type": "i64"
          },
          {
            "name": "minIntervalSec",
            "type": "i64"
          },
          {
            "name": "lastClaimTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "teamVestingInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "totalAllocation",
            "type": "u64"
          },
          {
            "name": "durationSec",
            "type": "i64"
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
      "name": "tokensClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "yApproved",
            "docs": [
              "Number of winning tickets."
            ],
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "updateEngineConfigParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "newTreasury",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "newCreationFee",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "newXyberMint",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "newAdmins",
            "type": {
              "option": {
                "array": [
                  "pubkey",
                  3
                ]
              }
            }
          },
          {
            "name": "newThreshold",
            "type": {
              "option": "u8"
            }
          }
        ]
      }
    },
    {
      "name": "updateLaunchParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hardCapLamports",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "minRaiseLamports",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "perWalletCap",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "tauLamports",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "baseTotalAllocation",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "baseSaleBasisPoints",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "teamAllocationBasisPoints",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "fundingDurationSeconds",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "unlockTimeSec",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "rosterShardCap",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "rosterShardsTotal",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "creatorInitialDepositLamports",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "creatorDailyLamportsLimit",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "creatorClaimLockPeriodSec",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "creatorMaxDeposit",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "poolCreationGracePeriodSec",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "teamVestingDurationSec",
            "type": {
              "option": "i64"
            }
          }
        ]
      }
    },
    {
      "name": "userContribution",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "deposited",
            "type": "u64"
          },
          {
            "name": "ticketCount",
            "type": "u32"
          },
          {
            "name": "claimedRefund",
            "type": "bool"
          },
          {
            "name": "claimedTokens",
            "type": "bool"
          },
          {
            "name": "shardId",
            "type": "u16"
          },
          {
            "name": "idxInShard",
            "type": "u32"
          },
          {
            "name": "finalizedSnapshot",
            "type": "bool"
          },
          {
            "name": "finalTBase",
            "type": "u32"
          },
          {
            "name": "finalTicketCount",
            "type": "u32"
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
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "ticketsBefore",
            "type": "u32"
          },
          {
            "name": "ticketsAfter",
            "type": "u32"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "totalTickets",
            "type": "u32"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "ammConfigIndex",
      "type": "u16",
      "value": "4"
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
      "value": "xybMB4dB3ogkzAojYMWTtjqPFgXKP6A7rbbFjAdfJa6"
    },
    {
      "name": "raydiumClmmProgramId",
      "type": "pubkey",
      "value": "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"
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
