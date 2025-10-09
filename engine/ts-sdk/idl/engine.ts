/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/engine.json`.
 */
export type Engine = {
  "address": "5W13VU4NkJbNHEX1CNFfjCzKGA7WeKqLzQoUDoLsoKjH",
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
          "name": "clmmProgram",
          "address": "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
        },
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
          "name": "poolState",
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "baseMint"
        },
        {
          "name": "quoteVault",
          "writable": true
        },
        {
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "baseTokenAta",
          "writable": true
        },
        {
          "name": "positionNftMint",
          "writable": true,
          "signer": true
        },
        {
          "name": "positionNftAccount",
          "writable": true
        },
        {
          "name": "metadataAccount",
          "writable": true
        },
        {
          "name": "personalPosition",
          "writable": true
        },
        {
          "name": "protocolPosition",
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
          "name": "quoteTokenAccount",
          "writable": true
        },
        {
          "name": "metadataProgram"
        },
        {
          "name": "token2022Program"
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
          "name": "selectionState",
          "writable": true
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
          "name": "selectionState",
          "writable": true
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
          "name": "clmmProgram",
          "address": "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
        },
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
          "name": "mintAuthority",
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
          "name": "ammConfig"
        },
        {
          "name": "poolState",
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "baseMint",
          "writable": true,
          "signer": true
        },
        {
          "name": "quoteVault",
          "writable": true
        },
        {
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "observationState",
          "writable": true
        },
        {
          "name": "tickArrayBitmap",
          "writable": true
        },
        {
          "name": "baseTokenAta",
          "writable": true
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
        "Create pool with blockhash verification",
        "Checks if any of the last 10 blockhashes meets the probability threshold"
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
          "name": "projectCounter",
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
      "name": "createPoolInternal",
      "docs": [
        "Internal function that handles pool creation logic",
        "skip_validation: if true, skips blockhash validation (for testing)"
      ],
      "discriminator": [
        69,
        110,
        78,
        61,
        47,
        49,
        49,
        169
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
          "name": "projectCounter",
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
      "args": [
        {
          "name": "skipValidation",
          "type": "bool"
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
          "name": "roster",
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
          "name": "launch",
          "relations": [
            "roster"
          ]
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
      "name": "finalizeSelection",
      "docs": [
        "Finalize selection: set threshold = K-th best score.",
        "(We DO NOT aggregate per-user here; claims recompute y_i locally.)"
      ],
      "discriminator": [
        3,
        226,
        213,
        146,
        195,
        126,
        174,
        228
      ],
      "accounts": [
        {
          "name": "selectionState",
          "writable": true
        },
        {
          "name": "launchState",
          "writable": true
        }
      ],
      "args": []
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
          "name": "admin",
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
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
          "name": "fundingDurationSec",
          "type": "i64"
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
          "name": "admin",
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
      "name": "openClaims",
      "docs": [
        "Open token claims (post-LP in production). Compute tokens_per_ticket = sale_allocation / K."
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
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "launchState",
          "writable": true
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
      "accounts": [
        {
          "name": "selectionState",
          "writable": true
        },
        {
          "name": "launchState",
          "writable": true
        },
        {
          "name": "roster",
          "writable": true
        }
      ],
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
          "name": "selectionState",
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
                  115,
                  101,
                  108,
                  101,
                  99,
                  116,
                  105,
                  111,
                  110
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
          "name": "roster",
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
          "name": "launch",
          "relations": [
            "roster"
          ]
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
      "name": "selectionState",
      "discriminator": [
        235,
        126,
        97,
        31,
        31,
        163,
        172,
        135
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
      "name": "notFullyProcessed",
      "msg": "Not fully processed"
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
      "name": "mintAlreadyExists",
      "msg": "Mint already exists"
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
            "name": "tokensPerTicket",
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
      "name": "heapEntry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "score",
            "type": "u128"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "localJ",
            "type": "u32"
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
            "name": "admin",
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
            "name": "admin",
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
            "name": "saleMint",
            "type": {
              "option": "pubkey"
            }
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
            "name": "clmmBaseMint",
            "type": {
              "option": "pubkey"
            }
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
            "name": "claimsOpen",
            "type": "bool"
          },
          {
            "name": "tokensPerTicket",
            "type": {
              "option": "u64"
            }
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
            "name": "nextProjectId",
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
            "name": "threshold",
            "type": "u128"
          },
          {
            "name": "kCapacity",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "selectionState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "vrfSeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "processed",
            "type": "u32"
          },
          {
            "name": "finalized",
            "type": "bool"
          },
          {
            "name": "threshold",
            "type": {
              "option": "u128"
            }
          },
          {
            "name": "heap",
            "type": {
              "vec": {
                "defined": {
                  "name": "heapEntry"
                }
              }
            }
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
