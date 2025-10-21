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
          "name": "raydiumProgram",
          "address": "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"
        },
        {
          "name": "launchState",
          "writable": true
        },
        {
          "name": "baseMint"
        },
        {
          "name": "escrow",
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
                  119
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
          "name": "quoteTokenAta",
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
          "name": "raydiumMetadataAccount",
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
          "name": "metadataProgram"
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "quoteTokenProgram"
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
          "name": "escrow",
          "writable": true
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
          "name": "saleMint",
          "writable": true
        },
        {
          "name": "mintAuth",
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
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
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
          "name": "rosterShard"
        },
        {
          "name": "escrow",
          "writable": true
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
          "name": "rosterShard"
        },
        {
          "name": "saleMint",
          "writable": true
        },
        {
          "name": "mintAuth",
          "docs": [
            "Seeds: [\"mint_auth\", launch_state]"
          ],
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
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
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
          "name": "escrow",
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
                  119
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
              "kind": "account",
              "path": "associatedTokenProgram"
            }
          }
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "raydiumAmmConfig"
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
          "name": "quoteTokenProgram"
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
      "name": "createPool",
      "docs": [
        "Create AMM pool"
      ],
      "discriminator": [
        233,
        146,
        209,
        142,
        207,
        104,
        64,
        188
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState"
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
          "name": "escrow",
          "docs": [
            "Escrow account (PDA off launch_state)"
          ],
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
                "kind": "account",
                "path": "saleMint"
              }
            ]
          }
        },
        {
          "name": "saleMint",
          "docs": [
            "Mint for sale tokens (program's mint authority will be PDA)"
          ],
          "writable": true
        },
        {
          "name": "escrow",
          "docs": [
            "Escrow account (PDA off launch_state)"
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
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
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
        }
      ]
    },
    {
      "name": "initRoster",
      "docs": [
        "Initialize roster account."
      ],
      "discriminator": [
        231,
        223,
        153,
        129,
        236,
        138,
        47,
        253
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
          "name": "roster",
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
      "args": []
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
      "name": "openClaims",
      "docs": [
        "Open claims after all shards finalized"
      ],
      "discriminator": [
        111,
        108,
        90,
        115,
        178,
        90,
        24,
        228
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
        }
      ],
      "args": []
    },
    {
      "name": "processBatch",
      "docs": [
        "Permissionless crank: process up to max_items tickets (t = processed ..)."
      ],
      "discriminator": [
        82,
        138,
        120,
        1,
        122,
        136,
        206,
        67
      ],
      "accounts": [],
      "args": [
        {
          "name": "maxItems",
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
          "name": "escrow",
          "docs": [
            "Escrow account (PDA off launch_state)"
          ],
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
      "name": "escrowAccount",
      "discriminator": [
        36,
        69,
        48,
        18,
        128,
        225,
        125,
        135
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
      "name": "roster",
      "discriminator": [
        211,
        108,
        170,
        22,
        253,
        177,
        162,
        194
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
      "name": "numBlocksUpdated",
      "discriminator": [
        169,
        68,
        39,
        54,
        104,
        241,
        228,
        223
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
      "name": "fundingPeriodNotEnded",
      "msg": "Funding period has not ended yet"
    },
    {
      "code": 6003,
      "name": "invalidFundingDuration",
      "msg": "Invalid funding duration (must be 0-5, where 0 = 10 seconds for testing)"
    },
    {
      "code": 6004,
      "name": "claimsNotOpen",
      "msg": "Claims are not open"
    },
    {
      "code": 6005,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6006,
      "name": "amountNotMultipleTau",
      "msg": "Amount must be multiple of tau"
    },
    {
      "code": 6007,
      "name": "perWalletCapExceeded",
      "msg": "Per-wallet cap exceeded"
    },
    {
      "code": 6008,
      "name": "insufficientDeposit",
      "msg": "Insufficient deposit"
    },
    {
      "code": 6009,
      "name": "seedAlreadySet",
      "msg": "Seed already set"
    },
    {
      "code": 6010,
      "name": "seedMissing",
      "msg": "Seed missing"
    },
    {
      "code": 6011,
      "name": "alreadyFinalized",
      "msg": "Selection already finalized"
    },
    {
      "code": 6012,
      "name": "notFinalized",
      "msg": "Selection not finalized"
    },
    {
      "code": 6013,
      "name": "thresholdMissing",
      "msg": "Threshold missing"
    },
    {
      "code": 6014,
      "name": "tokensPerTicketMissing",
      "msg": "Tokens per ticket missing"
    },
    {
      "code": 6015,
      "name": "invalidTau",
      "msg": "Invalid tau"
    },
    {
      "code": 6016,
      "name": "invalidK",
      "msg": "Invalid K"
    },
    {
      "code": 6017,
      "name": "invalidDivisor",
      "msg": "Divisor must be greater than zero"
    },
    {
      "code": 6018,
      "name": "heapNotFull",
      "msg": "Heap not full"
    },
    {
      "code": 6019,
      "name": "userNotFoundInRoster",
      "msg": "User not found in roster"
    },
    {
      "code": 6020,
      "name": "tOutOfRange",
      "msg": "t out of range"
    },
    {
      "code": 6021,
      "name": "mappingError",
      "msg": "Mapping error"
    },
    {
      "code": 6022,
      "name": "alreadyClaimedRefund",
      "msg": "Already claimed refund"
    },
    {
      "code": 6023,
      "name": "alreadyClaimedTokens",
      "msg": "Already claimed tokens"
    },
    {
      "code": 6024,
      "name": "noRecentBlockhashes",
      "msg": "No recent blockhashes found in SlotHashes sysvar"
    },
    {
      "code": 6025,
      "name": "poolAlreadyCreated",
      "msg": "Pool already created"
    },
    {
      "code": 6026,
      "name": "noValidBlockhash",
      "msg": "No valid blockhash found in recent blocks"
    },
    {
      "code": 6027,
      "name": "invalidNumBlocks",
      "msg": "Invalid N value for hash range calculation (must be between MIN_N and MAX_N)"
    },
    {
      "code": 6028,
      "name": "invalidSlotHashesData",
      "msg": "Invalid slot hashes data"
    },
    {
      "code": 6029,
      "name": "rosterFull",
      "msg": "Roster is full"
    },
    {
      "code": 6030,
      "name": "heapCapacityExceeded",
      "msg": "Heap capacity exceeded"
    },
    {
      "code": 6031,
      "name": "mintAlreadyExists",
      "msg": "Mint already exists"
    },
    {
      "code": 6032,
      "name": "arithmeticOverflow",
      "msg": "An arithmetic operation overflowed"
    },
    {
      "code": 6033,
      "name": "u64ConversionOverflow",
      "msg": "u64 to u32 conversion overflow"
    },
    {
      "code": 6034,
      "name": "reservedExceedsCapacity",
      "msg": "Creator reserved tickets exceed capacity"
    },
    {
      "code": 6035,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    },
    {
      "code": 6036,
      "name": "invalidCreatorDeposit",
      "msg": "Creator initial deposit must be multiple of tau"
    },
    {
      "code": 6037,
      "name": "creatorRefundAlreadyClaimed",
      "msg": "Creator refund already claimed"
    },
    {
      "code": 6038,
      "name": "invalidMint",
      "msg": "Invalid mint for ATA"
    },
    {
      "code": 6039,
      "name": "invalidOwner",
      "msg": "Invalid owner for ATA"
    },
    {
      "code": 6040,
      "name": "invalidHardCap",
      "msg": "Hard cap must be > 0"
    },
    {
      "code": 6041,
      "name": "invalidMinRaise",
      "msg": "Min raise must be > 0"
    },
    {
      "code": 6042,
      "name": "hardCapNotDivisibleByTau",
      "msg": "Hard cap must be divisible by tau"
    },
    {
      "code": 6043,
      "name": "perWalletCapTooSmall",
      "msg": "Per-wallet cap must be >= tau"
    },
    {
      "code": 6044,
      "name": "minRaiseTooHigh",
      "msg": "Min raise must be <= hard cap"
    },
    {
      "code": 6045,
      "name": "invalidClaimLockPeriod",
      "msg": "Creator claim lock period must be > 0"
    },
    {
      "code": 6046,
      "name": "notSupported",
      "msg": "Operation not supported in current version"
    },
    {
      "code": 6047,
      "name": "rosterShardFull",
      "msg": "Roster shard is full"
    },
    {
      "code": 6048,
      "name": "invalidFinalizeOrder",
      "msg": "Roster finalization order violated"
    },
    {
      "code": 6049,
      "name": "shardNotFinalized",
      "msg": "Roster shard not finalized"
    },
    {
      "code": 6050,
      "name": "shardsNotFullyFinalized",
      "msg": "Claims cannot be opened before all shards finalized"
    },
    {
      "code": 6051,
      "name": "noTokensToClaim",
      "msg": "User has no tokens to claim"
    },
    {
      "code": 6052,
      "name": "noDistributionRules",
      "msg": "No distribution rules found for market cap"
    },
    {
      "code": 6053,
      "name": "recipientNotFound",
      "msg": "Recipient not found in distribution"
    },
    {
      "code": 6054,
      "name": "invalidShareSum",
      "msg": "Sum of shares in tier must equal 10000 basis points"
    },
    {
      "code": 6055,
      "name": "invalidBaseDecimals",
      "msg": "Base token decimals must be less than 18"
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
      "name": "escrowAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "balance",
            "type": "u64"
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
            "name": "saleAllocation",
            "type": "u64"
          },
          {
            "name": "lpAllocation",
            "type": "u64"
          },
          {
            "name": "fundingDurationSeconds",
            "type": "i64"
          },
          {
            "name": "numBlocks",
            "type": "u64"
          },
          {
            "name": "rosterShardCap",
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
            "name": "saleMint",
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
            "name": "saleAllocation",
            "type": "u64"
          },
          {
            "name": "lpAllocation",
            "type": "u64"
          },
          {
            "name": "numBlocks",
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
            "name": "numBlocks",
            "type": "u64"
          },
          {
            "name": "saleMint",
            "type": "pubkey"
          },
          {
            "name": "saleAllocation",
            "type": "u64"
          },
          {
            "name": "totalLaunchAllocation",
            "type": "u64"
          },
          {
            "name": "lpAllocation",
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
            "name": "rosterFinalizedUpTo",
            "type": "i32"
          },
          {
            "name": "publicTotalTickets",
            "type": "u32"
          },
          {
            "name": "claimsOpen",
            "type": "bool"
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
            "name": "rosterShardCap",
            "type": "u16"
          },
          {
            "name": "clmmBaseMint",
            "type": {
              "option": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "numBlocksUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "newNumBlocks",
            "type": "u64"
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
          },
          {
            "name": "rangeStart",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rangeEnd",
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
            "name": "rangeStart",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rangeEnd",
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
      "name": "roster",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
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
      "name": "seedRoot",
      "type": "bytes",
      "value": "[114, 111, 111, 116, 45, 48, 45, 49, 48, 48, 45, 49]"
    }
  ]
};
