use std::error::Error;

use serde::Serializer;

pub fn error_serialize<S: Serializer, E: Error>(error: &E, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&error.to_string())
}

#[macro_export]
macro_rules! serialize_as_message {
    ($($ty:ty),+ $(,)?) => {
        $(
            impl serde::Serialize for $ty {
                fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                    serializer.serialize_str(&self.to_string())
                }
            }
        )+
    };
}
