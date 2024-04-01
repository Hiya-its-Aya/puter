/*
 * Copyright (C) 2024 Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
const { TimeWindow } = require("../util/opmath");
const SmolUtil = require("../util/smolutil");
const { format_as_usd } = require("../util/strutil");
const { MINUTE, SECOND } = require("../util/time");
const BaseService = require("./BaseService");

class TrackSpendingService extends BaseService {
    static ChatCompletionStrategy = class ChatCompletionStrategy {
        static models = {
            'gpt-4-1106-preview': {
                cost_per_input_token: [0.01, 1000],
                cost_per_output_token: [0.03, 1000],
            },
            'gpt-4-vision-preview': {
                cost_per_input_token: [0.01, 1000],
                cost_per_output_token: [0.03, 1000],
            },
            'gpt-3.5-turbo': {
                cost_per_input_token: [0.001, 1000],
                cost_per_output_token: [0.002, 1000],
            },
        };
        constructor ({ service }) {
            this.service = service;
        }

        multiply_by_ratio_ (value, [numerator, denominator]) {
            return value * numerator / denominator;
        }

        get_cost (vendor, data) {
            const model = data.model ?? 'gpt-4-1106-preview';
            const model_pricing = this.constructor.models[model];

            if ( ! model_pricing ) {
                throw new Error(`unknown model ${model}`);
            }

            const cost_per_input_token = model_pricing.cost_per_input_token;
            const cost_per_output_token = model_pricing.cost_per_output_token;

            const input_tokens = data.count_tokens_input ?? 0;
            const output_tokens = data.count_tokens_output ?? 0;

            const cost = SmolUtil.add(
                this.multiply_by_ratio_(input_tokens, cost_per_input_token),
                this.multiply_by_ratio_(output_tokens, cost_per_output_token),
            );

            console.log('COST IS', cost);

            return cost;
        }

        async validate () {
            // Ensure no models will cause division by zero
            for ( const model in this.constructor.models ) {
                const model_pricing = this.constructor.models[model];
                if ( model_pricing.cost_per_input_token[1] === 0 ) {
                    throw new Error(`model ${model} pricing conf (input tokens) will cause division by zero`);
                }
                if ( model_pricing.cost_per_output_token[1] === 0 ) {
                    throw new Error(`model ${model} pricing conf (output tokens) will cause division by zero`);
                }
            }
        }
    }
    static ImageGenerationStrategy = class ImageGenerationStrategy {
        static models = {
            'dall-e-3': {
                '1024x1024': 0.04,
                '1024x1792': 0.08,
                '1792x1024': 0.08,
                'hd:1024x1024': 0.08,
                'hd:1024x1792': 0.12,
                'hd:1792x1024': 0.12,
            },
            'dall-e-2': {
                '1024x1024': 0.02,
                '512x512': 0.018,
                '256x256': 0.016,
            },
        };
        constructor ({ service }) {
            this.service = service;
        }

        multiply_by_ratio_ (value, [numerator, denominator]) {
            return value * numerator / denominator;
        }

        get_cost (vendor, data) {
            const model = data.model ?? 'dall-e-2';
            const model_pricing = this.constructor.models[model];

            if ( ! model_pricing ) {
                throw new Error(`unknown model ${model}`);
            }

            if ( ! model_pricing.hasOwnProperty(data.size) ) {
                throw new Error(`unknown size ${data.size} for model ${model}`);
            }

            const cost = model_pricing[data.size];

            console.log('COST IS', cost);

            return cost;
        }
    }

    async _init () {
        const strategies = {
            'chat-completion': new this.constructor.ChatCompletionStrategy({
                service: this,
            }),
            'image-generation': new this.constructor.ImageGenerationStrategy({
                service: this,
            }),
        };

        // How quickly we get the first alarm
        const alarm_check_interval = 10 * SECOND;

        // How frequently we'll get repeat alarms
        const alarm_cooldown_time = 30 * MINUTE;

        const alarm_at_cost = this.config.alarm_at_cost ?? 1;
        const alarm_increment = this.config.alarm_increment ?? 1;

        for ( const k in strategies ) {
            await strategies[k].validate?.();
        }

        if ( ! this.log ) {
            throw new Error('no log?');
        }

        this.strategies = strategies;

        // Tracks overall server spending
        this.spend_windows = {};

        // Tracks what dollar amounts alerts were reported for
        this.alerts_window = new TimeWindow({
            // window_duration: 30 * MINUTE,
            window_duration: alarm_cooldown_time,
            reducer: a => Math.max(0, ...a),
        });

        const svc_alarm = this.services.get('alarm');

        setInterval(() => {
            const spending = this.get_window_spending_();

            const increment = Math.floor(spending / alarm_increment);
            const last_increment = this.alerts_window.get();

            if ( increment <= last_increment ) {
                return;
            }

            this.log.info('adding that increment');
            this.alerts_window.add(increment);

            if ( spending >= alarm_at_cost ) {
                // see: src/polyfill/to-string-higher-radix.js
                const ts_for_id = Date.now().toString(62);

                this.log.info('triggering alarm');
                this.log.info('alarm at: ' + alarm_at_cost);
                this.log.info('spend: ' + this.get_window_spending_());
                svc_alarm.create(
                    `high-spending-${ts_for_id}`,
                    `server spending is ${spending} within 30 minutes`,
                    {
                        spending,
                        increment_level: increment,
                    },
                );
            }
        }, alarm_check_interval);
    }

    add_or_get_window_ (id) {
        if ( this.spend_windows[id] ) {
            return this.spend_windows[id];
        }

        return this.spend_windows[id] = new TimeWindow({
            // window_duration: 30 * MINUTE,
            window_duration: 30 * MINUTE,
            reducer: a => a.reduce((a, b) => a + b, 0),
        });
    }

    get_window_spending_ () {
        const windows = Object.values(this.spend_windows);
        return windows.reduce((sum, win) => {
            return sum + win.get();
        }, 0);
    }

    record_spending (vendor, strategy_key, data) {
        const strategy = this.strategies[strategy_key];
        if ( ! strategy ) {
            throw new Error(`unknown strategy ${strategy_key}`);
        }

        const cost = strategy.get_cost(vendor, data);

        this.log.info(`Spent ${format_as_usd(cost)}`, {
            vendor, strategy_key, data,
            cost,
        })

        const id = `${vendor}:${strategy_key}`;
        const window = this.add_or_get_window_(id);
        window.add(cost);
    }
}

module.exports = {
    TrackSpendingService,
};
