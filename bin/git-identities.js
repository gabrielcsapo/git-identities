#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const os = require('os')
const { promisify } = require('util')
const child_process = require('child_process')

const readdir = promisify(fs.readdir)

const Conf = require('conf')
const { Command } = require('commander')
const chalk = require('chalk')
const { Select, Toggle, Input, prompt } = require('enquirer')

const config = new Conf()

const program = new Command()

function formatIdentityString (identity) {
  return `Nickname ${identity.nickname} Name: ${identity.name} - Email: ${identity.email} - SSH Key: ${identity.sshLocation}`
}

async function identityNotFound ({ name, email }) {
  console.log('Name: ', name)
  console.log('Email: ', email)

  const storeIdentity = await new Toggle({
    message:
      'No stored identities with this configuration, would you like to save this?',
    enabled: 'Yep',
    disabled: 'Nope'
  }).run()

  if (storeIdentity) {
    try {
      child_process.spawn(
        'node',
        [
          `${__dirname}/git-identities.js`,
          'add',
          '--username',
          name,
          '--email',
          email
        ],
        {
          detached: true,
          stdio: 'inherit'
        }
      )
    } catch (ex) {
      console.log(ex)
    }
  }
}

program.name('git-identities').version(require('../package.json').version)

program
  .command('switch', { isDefault: true })
  .description('Switch the current git identiy with one that is stored')
  .action(async () => {
    const identities = config.get('identities')

    console.log(chalk.underline(`Identities loaded from "${config.path}"`))

    if (!identities || identities.length === 0) {
      console.log()
      console.log(
        chalk.red(
          '> Sorry, there are no identies stored. Please use `git identities add` to go through the flow of adding an identity'
        )
      )
      console.log()
      return
    }

    const identityToSwitchTo = await new Select({
      name: 'identity',
      message: 'Please select an identity to swtich to.',
      choices: identities.map(identity => {
        return {
          name: identity,
          message: formatIdentityString(identity)
        }
      })
    }).run()

    try {
      child_process.execSync(
        `git config --global user.name "${identityToSwitchTo.name}"`
      )
      child_process.execSync(
        `git config user.email "${identityToSwitchTo.email}"`
      )
      child_process.execSync('eval "$(ssh-agent -s)"')
      child_process.execSync(`ssh-add -K ${identityToSwitchTo.sshLocation}`)
    } catch (ex) {
      console.log(
        `Failure to switch to "${identityToSwitchTo.nickname}" because of \n ${ex.message}`
      )
    }
  })

program
  .command('me')
  .description('Shows the current git identity selected')
  .action(async () => {
    const identities = config.get('identities')

    const name = child_process
      .execSync('git config user.name')
      .toString('utf8')
      .trim()
    const email = child_process
      .execSync('git config user.email')
      .toString('utf8')
      .trim()

    if (identities && Array.isArray(identities) && identities.length > 0) {
      const foundIdentity = identities.find(identity => {
        return identity.name === name && identity.email === email
      })

      if (foundIdentity) {
        console.log(chalk.bold.italic.underline('This identity is saved'))
        console.log('Nickname: ', foundIdentity.nickname)
        console.log('Name: ', name)
        console.log('Email: ', email)
        console.log('sshLocation: ', foundIdentity.sshLocation)
      } else {
        await identityNotFound({ name, email })
      }
    } else {
      await identityNotFound({ name, email })
    }
  })

program
  .command('delete')
  .description('Delete a git identity that is stored')
  .action(async () => {
    const identities = config.get('identities')

    if (!identities) {
      console.log(
        'Sorry, there are no identies stored. Please use `git identities add` to go through the flow of adding an identity'
      )
      return
    }

    const identitiesLeft = await new Select({
      name: 'ssh_identity',
      message: 'Please select the SSH Key associated with this git identity?',
      choices: identities.map(identity => {
        return {
          name: identity,
          message: formatIdentityString(identity)
        }
      }),
      result: identity => {
        console.log('Deleting', formatIdentityString(identity))

        return identities.filter(_identity => _identity !== identity)
      }
    }).run()

    config.set('identities', identitiesLeft)
  })

program
  .command('add')
  .description('Adds a git identity to switch to')
  .option('-u,--username <username>')
  .option('-e,--email <email>')
  .action(async options => {
    const { nickname, email, name } = await prompt([
      {
        type: 'input',
        name: 'nickname',
        message: 'What is the nick name of this git identity?'
      },
      {
        type: 'input',
        name: 'name',
        initial: (options && options.username) || '',
        message: 'What is the name of this git identity?'
      },
      {
        type: 'input',
        name: 'email',
        initial: (options && options.email) || '',
        message: 'What is the email associated with this git identity?'
      }
    ])

    const potentialSshFiles = await readdir(path.resolve(os.homedir(), '.ssh'))
    let sshLocation = await new Select({
      name: 'ssh_identity',
      message: 'Please select the SSH Key associated with this git identity?',
      choices: ['Custom Location...', ...potentialSshFiles],
      result: value => {
        return path.resolve(os.homedir(), '.ssh', value)
      }
    }).run()

    if (sshLocation === 'Custom Location...') {
      sshLocation = await new Input({
        message:
          'What is the path of the ssh key associated with this git identity?',
        validate: sshKeyPath => {
          return fs.existsSync(sshKeyPath)
        }
      }).run()
    }

    const isCorrect = await new Toggle({
      message: `${formatIdentityString({
        nickname,
        name,
        email,
        sshLocation
      })}: Is this correct?`,
      enabled: 'Yep',
      disabled: 'Nope'
    }).run()

    if (isCorrect) {
      let identities = config.get('identities')
      if (!identities) {
        identities = []
      }
      identities.push({
        nickname,
        name,
        email,
        sshLocation
      })
      config.set('identities', identities)
    } else {
      console.log('Restarting the add flow')

      child_process.spawn('node', [`${__dirname}/git-identities.js`, 'add'], {
        detached: true,
        stdio: 'inherit'
      })
    }
  })

program.parse(process.argv)
