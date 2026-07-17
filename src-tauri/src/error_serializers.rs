use std::error::Error;

use serde::Serializer;

pub fn error_serialize<S: Serializer, E: Error>(error: &E, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&error.to_string())
}
