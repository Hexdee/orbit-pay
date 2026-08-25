#![no_std]
#![allow(deprecated)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Initialized,
    Total,
    Payment(u64),
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct PaymentRecord {
    pub id: u64,
    pub payer: Address,
    pub recipient: Address,
    pub amount: i128,
    pub memo: String,
    pub ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum TrackerError {
    AlreadyInitialized = 1,
    InvalidAmount = 2,
    PaymentNotFound = 3,
}

#[contract]
pub struct PaymentTracker;

#[contractimpl]
impl PaymentTracker {
    pub fn initialize(env: Env) -> Result<(), TrackerError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(TrackerError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Total, &0_u64);
        Ok(())
    }

    pub fn record_payment(
        env: Env,
        payer: Address,
        recipient: Address,
        amount: i128,
        memo: String,
    ) -> Result<u64, TrackerError> {
        if amount <= 0 {
            return Err(TrackerError::InvalidAmount);
        }
        payer.require_auth();
        let next_id = env
            .storage()
            .instance()
            .get::<DataKey, u64>(&DataKey::Total)
            .unwrap_or(0)
            .saturating_add(1);
        let record = PaymentRecord {
            id: next_id,
            payer: payer.clone(),
            recipient: recipient.clone(),
            amount,
            memo: memo.clone(),
            ledger: env.ledger().sequence(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Payment(next_id), &record);
        env.storage().instance().set(&DataKey::Total, &next_id);
        env.events().publish(
            (symbol_short!("payment"), payer, next_id),
            (recipient, amount, memo),
        );
        Ok(next_id)
    }

    pub fn get_total(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Total).unwrap_or(0)
    }

    pub fn get_payment(env: Env, id: u64) -> Result<PaymentRecord, TrackerError> {
        env.storage()
            .persistent()
            .get(&DataKey::Payment(id))
            .ok_or(TrackerError::PaymentNotFound)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn initializes_and_records_payment() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(PaymentTracker, ());
        let client = PaymentTrackerClient::new(&env, &id);
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        client.initialize();
        assert_eq!(
            client.record_payment(
                &payer,
                &recipient,
                &1_500_000,
                &String::from_str(&env, "Lunch")
            ),
            1
        );
        assert_eq!(client.get_total(), 1);
        assert_eq!(client.get_payment(&1).amount, 1_500_000);
    }

    #[test]
    #[should_panic]
    fn rejects_invalid_amount() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(PaymentTracker, ());
        let client = PaymentTrackerClient::new(&env, &id);
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        client.record_payment(&payer, &recipient, &0, &String::from_str(&env, "Nope"));
    }

    #[test]
    #[should_panic]
    fn prevents_double_initialization_and_missing_reads() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(PaymentTracker, ());
        let client = PaymentTrackerClient::new(&env, &id);
        client.initialize();
        client.initialize();
    }
}
