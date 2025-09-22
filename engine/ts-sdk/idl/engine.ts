/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/engine.json`.
 */
export type Engine = {
  "address": "HMVJWXWhpxEWWGhvLHYnTvkmYJcA819jAxw3EgdNYiYb",
  "metadata": {
    "name": "engine",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
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
      "name": "closeDeposits",
      "docs": [
        "Close deposits, build prefix, set N and K."
      ],
      "discriminator": [
        32,
        132,
        87,
        145,
        240,
        56,
        34,
        245
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
          "writable": true
        },
        {
          "name": "launch",
          "relations": [
            "roster"
          ]
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
      "name": "openFunding",
      "docs": [
        "Open funding window."
      ],
      "discriminator": [
        255,
        94,
        231,
        132,
        50,
        44,
        163,
        83
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
          "name": "launchState"
        },
        {
          "name": "roster"
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
        "MVP seed setter (PoC instead of VRF): admin provides a 32-byte seed."
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
          "name": "admin",
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
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
  "errors": [
    {
      "code": 6000,
      "name": "notOpen",
      "msg": "Funding window is not open"
    },
    {
      "code": 6001,
      "name": "claimsNotOpen",
      "msg": "Claims are not open"
    },
    {
      "code": 6002,
      "name": "alreadyClosed",
      "msg": "Deposits already closed"
    },
    {
      "code": 6003,
      "name": "notClosed",
      "msg": "Deposits not closed"
    },
    {
      "code": 6004,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6005,
      "name": "amountNotMultipleTau",
      "msg": "Amount must be multiple of tau"
    },
    {
      "code": 6006,
      "name": "perWalletCapExceeded",
      "msg": "Per-wallet cap exceeded"
    },
    {
      "code": 6007,
      "name": "insufficientDeposit",
      "msg": "Insufficient deposit"
    },
    {
      "code": 6008,
      "name": "seedAlreadySet",
      "msg": "Seed already set"
    },
    {
      "code": 6009,
      "name": "seedMissing",
      "msg": "Seed missing"
    },
    {
      "code": 6010,
      "name": "alreadyFinalized",
      "msg": "Selection already finalized"
    },
    {
      "code": 6011,
      "name": "notFinalized",
      "msg": "Selection not finalized"
    },
    {
      "code": 6012,
      "name": "thresholdMissing",
      "msg": "Threshold missing"
    },
    {
      "code": 6013,
      "name": "tokensPerTicketMissing",
      "msg": "Tokens per ticket missing"
    },
    {
      "code": 6014,
      "name": "invalidTau",
      "msg": "Invalid tau"
    },
    {
      "code": 6015,
      "name": "invalidK",
      "msg": "Invalid K"
    },
    {
      "code": 6016,
      "name": "notFullyProcessed",
      "msg": "Not fully processed"
    },
    {
      "code": 6017,
      "name": "heapNotFull",
      "msg": "Heap not full"
    },
    {
      "code": 6018,
      "name": "userNotFoundInRoster",
      "msg": "User not found in roster"
    },
    {
      "code": 6019,
      "name": "tOutOfRange",
      "msg": "t out of range"
    },
    {
      "code": 6020,
      "name": "mappingError",
      "msg": "Mapping error"
    },
    {
      "code": 6021,
      "name": "alreadyClaimedRefund",
      "msg": "Already claimed refund"
    },
    {
      "code": 6022,
      "name": "alreadyClaimedTokens",
      "msg": "Already claimed tokens"
    }
  ],
  "types": [
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
            "type": "pubkey"
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
            "name": "fundingOpen",
            "type": "bool"
          },
          {
            "name": "depositsClosed",
            "type": "bool"
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
    }
  ]
};
