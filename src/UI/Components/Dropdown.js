/**
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
import { Component, defineComponent } from "../../util/Component.js";

/**
 * Dropdown: A labeled dropdown/select input.
 */
export default class Dropdown extends Component {
    static PROPERTIES = {
        name: { value: null },
        label: { value: null },
        value: { value: null },
        on_change: { value: null },
    };

    static RENDER_MODE = Component.NO_SHADOW;

    static CSS = /*css*/`
        .dropdown-label {
            color: var(--primary-color);
        }

        .dropdown-input {
            --webkit-appearance: none;
            width: 100%;
            background: #d3d3d3;
            outline: none;
            opacity: 0.7;
            --webkit-transition: .2s;
            transition: opacity .2s;
        }
        
        .dropdown-input:hover {
            opacity: 1;
        }
        
        .dropdown-input::-webkit-dropdown-thumb {
            --webkit-appearance: none;
            appearance: none;
            width: 25px;
            background: #04AA6D;
            cursor: pointer;
        }
        
        .dropdown-input::-moz-range-thumb {
            width: 25px;
            background: #04AA6D;
            cursor: pointer;
        }
    `;

    create_template ({ template }) {
        const value = this.get('value') ?? 'light'; 
        const label = this.get('label') ?? this.get('name');

        console.log(this.get('name'))

        $(template).html(/*html*/`
            <div class="dropdown">
                <label class="dropdown-label">${html_encode(label)}</label>
                <select class="dropdown-input">
                  <option value='dark'>Dark</option>
                  <option value='light'>Light</option>
                  <option value='system'>System</option>
                </select>
            </div>
        `);

        // Set attributes here to prevent XSS injection
        $(template).find('.dropdown-input').attr('value', value);
    }

    on_ready ({ listen }) {
        const input = this.dom_.querySelector('.dropdown-input');

        input.addEventListener('input', e => {
            const on_change = this.get('on_change');
            if (on_change) {
                const name = this.get('name');
                const label = this.get('label') ?? name;
                e.meta = { name, label };
                on_change(e);
            }
        });

        listen('value', value => {
            input.value = value;
        });
    }
}

defineComponent('c-dropdown', Dropdown);
