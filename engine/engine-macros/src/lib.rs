use proc_macro::TokenStream;
use quote::quote;
use std::fs;
use std::path::PathBuf;

#[proc_macro]
pub fn declare_id_from_keypair(input: TokenStream) -> TokenStream {
    let input_str = input.to_string();
    let path_str = input_str.trim().trim_matches('"');

    let cargo_manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let manifest_path = PathBuf::from(&cargo_manifest_dir);
    let workspace_root = manifest_path
        .parent()
        .and_then(|p| p.parent())
        .expect("Failed to find workspace root");
    let keypair_path = workspace_root.join(path_str);

    let keypair_data = match fs::read_to_string(&keypair_path) {
        Ok(data) => data,
        Err(e) => {
            return syn::Error::new(
                proc_macro2::Span::call_site(),
                format!("Failed to read keypair file: {}", e)
            )
            .to_compile_error()
            .into();
        }
    };

    let keypair_bytes: Vec<u8> = match serde_json::from_str(&keypair_data) {
        Ok(bytes) => bytes,
        Err(e) => {
            return syn::Error::new(
                proc_macro2::Span::call_site(),
                format!("Failed to parse keypair JSON: {}", e)
            )
            .to_compile_error()
            .into();
        }
    };

    if keypair_bytes.len() < 64 {
        return syn::Error::new(
            proc_macro2::Span::call_site(),
            "Invalid keypair: insufficient bytes"
        )
        .to_compile_error()
        .into();
    }

    let pubkey_bytes = &keypair_bytes[32..64];
    let pubkey_base58 = bs58::encode(pubkey_bytes).into_string();

    let expanded = quote! {
        ::anchor_lang::declare_id!(#pubkey_base58);
    };

    expanded.into()
}
